// Package tlscert creates and persists the self-signed certificate the
// backend's loopback TLS listener uses.
//
// The TLS listener exists for HTTP/2: browsers refuse cleartext h2c, so the
// only way to get request multiplexing (and with it an end to the six
// connections per origin the dex page's sprite flood queues behind) is a TLS
// endpoint. Nothing outside this machine ever sees the certificate, so it is
// self-signed and pinned by fingerprint on the client side rather than being
// chained to a trust store.
package tlscert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

const (
	// dirName is the subdirectory of the config directory holding the pair.
	dirName = "tls"
	// certFile and keyFile are the PEM files inside that directory.
	certFile = "cert.pem"
	keyFile  = "key.pem"

	// dirMode keeps the directory owner-only, matching the key inside it.
	dirMode os.FileMode = 0o700
	// keyMode must stay owner-read-only: the private key authenticates the
	// local API endpoint, so another account on the machine must not read it.
	keyMode os.FileMode = 0o600
	// certMode is world readable on purpose, the certificate is public.
	certMode os.FileMode = 0o644

	// validity is the lifetime of a freshly issued certificate. 825 days is
	// the conventional maximum for a leaf certificate.
	validity = 825 * 24 * time.Hour
	// renewBefore is how much remaining lifetime still counts as usable. A
	// certificate that expires while the app is installed would fail in a way
	// that is very hard to recognize, so it is replaced well ahead of time.
	renewBefore = 30 * 24 * time.Hour
	// backdate absorbs clock skew between issuing and validating, which on a
	// single machine is small but not always zero.
	backdate = time.Hour
)

// Dir returns the directory holding the certificate pair for configDir.
func Dir(configDir string) string {
	return filepath.Join(configDir, dirName)
}

// EnsureCertificate returns the loopback certificate for configDir, creating
// the pair under <configDir>/tls when none is usable yet. It also returns the
// certificate's fingerprint: the lowercase hex SHA-256 of the leaf's DER
// bytes, which is what a client pins instead of validating a chain.
//
// An existing pair is reused when it parses, its key matches, and it has more
// than 30 days of validity left. Anything else is regenerated.
func EnsureCertificate(configDir string) (tls.Certificate, string, error) {
	dir := Dir(configDir)
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return tls.Certificate{}, "", fmt.Errorf("create tls directory: %w", err)
	}
	certPath := filepath.Join(dir, certFile)
	keyPath := filepath.Join(dir, keyFile)

	if cert, fp, ok := loadExisting(certPath, keyPath); ok {
		return cert, fp, nil
	}

	cert, fp, err := generate(certPath, keyPath)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	return cert, fp, nil
}

// loadExisting reads the pair from disk and reports whether it is still usable.
// Every failure is a plain "not usable" rather than an error: the only reaction
// to a missing, corrupt or expiring pair is to write a new one.
func loadExisting(certPath, keyPath string) (tls.Certificate, string, bool) {
	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return tls.Certificate{}, "", false
	}
	if len(cert.Certificate) == 0 {
		return tls.Certificate{}, "", false
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		return tls.Certificate{}, "", false
	}
	if time.Now().Add(renewBefore).After(leaf.NotAfter) {
		return tls.Certificate{}, "", false
	}
	cert.Leaf = leaf
	return cert, fingerprint(cert.Certificate[0]), true
}

// generate writes a fresh key pair and self-signed certificate to disk and
// returns it ready for use.
func generate(certPath, keyPath string) (tls.Certificate, string, error) {
	// P-256 rather than RSA: the handshake is faster, the files are smaller,
	// and no client here needs an RSA key.
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("generate key: %w", err)
	}

	der, err := createCertificate(key)
	if err != nil {
		return tls.Certificate{}, "", err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("marshal key: %w", err)
	}

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	if err := writeFileMode(certPath, certPEM, certMode); err != nil {
		return tls.Certificate{}, "", fmt.Errorf("write certificate: %w", err)
	}
	if err := writeFileMode(keyPath, keyPEM, keyMode); err != nil {
		return tls.Certificate{}, "", fmt.Errorf("write key: %w", err)
	}

	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("load generated pair: %w", err)
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return tls.Certificate{}, "", fmt.Errorf("parse generated certificate: %w", err)
	}
	cert.Leaf = leaf
	return cert, fingerprint(der), nil
}

// createCertificate self-signs a leaf certificate for the loopback names.
func createCertificate(key *ecdsa.PrivateKey) ([]byte, error) {
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generate serial: %w", err)
	}

	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "Encounty local", Organization: []string{"Encounty"}},
		NotBefore:    now.Add(-backdate),
		NotAfter:     now.Add(validity),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		// The IP SANs are not optional: a client that connects to 127.0.0.1 or
		// ::1 checks the address against the IP SANs, and a DNS SAN for
		// localhost alone does not satisfy that.
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		BasicConstraintsValid: true,
		IsCA:                  false,
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("create certificate: %w", err)
	}
	return der, nil
}

// writeFileMode writes data with exactly mode. The existing file is removed
// first because os.WriteFile applies the mode only when it creates the file,
// so a regenerated key would otherwise inherit whatever permissions the
// previous one had.
func writeFileMode(path string, data []byte, mode os.FileMode) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(path, data, mode)
}

// fingerprint returns the lowercase hex SHA-256 over the certificate's DER
// bytes, the same value a client computes from the certificate it is offered.
func fingerprint(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}
