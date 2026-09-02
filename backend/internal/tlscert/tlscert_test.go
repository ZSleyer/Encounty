// Package tlscert tests certificate creation, reuse and the file permissions
// that keep the private key readable by its owner alone.
package tlscert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

const fmtEnsureErr = "EnsureCertificate: %v"

// TestEnsureCertificateCreatesUsablePair covers the fresh-directory path: the
// files appear where they are expected and the certificate carries the SANs a
// loopback client validates against.
func TestEnsureCertificateCreatesUsablePair(t *testing.T) {
	dir := t.TempDir()

	cert, fp, err := EnsureCertificate(dir)
	if err != nil {
		t.Fatalf(fmtEnsureErr, err)
	}
	if cert.Leaf == nil {
		t.Fatal("Leaf is nil, the caller needs the parsed certificate")
	}
	if len(fp) != 64 {
		t.Errorf("fingerprint length = %d, want 64 hex characters", len(fp))
	}
	for _, r := range fp {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			t.Fatalf("fingerprint contains %q, want lowercase hex only", r)
		}
	}

	for _, name := range []string{certFile, keyFile} {
		if _, err := os.Stat(filepath.Join(Dir(dir), name)); err != nil {
			t.Errorf("stat %s: %v", name, err)
		}
	}

	leaf := cert.Leaf
	if len(leaf.DNSNames) != 1 || leaf.DNSNames[0] != "localhost" {
		t.Errorf("DNSNames = %v, want [localhost]", leaf.DNSNames)
	}
	for _, ip := range []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback} {
		if err := leaf.VerifyHostname(ip.String()); err != nil {
			t.Errorf("VerifyHostname(%s): %v", ip, err)
		}
	}
	if err := leaf.VerifyHostname("localhost"); err != nil {
		t.Errorf("VerifyHostname(localhost): %v", err)
	}
	if _, ok := leaf.PublicKey.(*ecdsa.PublicKey); !ok {
		t.Errorf("public key is %T, want *ecdsa.PublicKey", leaf.PublicKey)
	}

	wantNotAfter := time.Now().Add(validity)
	if diff := leaf.NotAfter.Sub(wantNotAfter); diff > time.Minute || diff < -time.Minute {
		t.Errorf("NotAfter = %v, want about %v", leaf.NotAfter, wantNotAfter)
	}
	if !leaf.NotBefore.Before(time.Now()) {
		t.Errorf("NotBefore = %v, want a backdated time", leaf.NotBefore)
	}
}

// TestKeyFileIsNotWorldReadable pins the permission bits on the private key
// and its directory.
func TestKeyFileIsNotWorldReadable(t *testing.T) {
	// Windows has no Unix permission bits: os.Chmod there only flips the
	// read-only flag, so the mode a file reports says nothing about who may
	// read it. The bits are still passed on every platform, they are simply
	// not assertable here.
	if runtime.GOOS == "windows" {
		t.Skip("permission bits are not modeled on Windows")
	}

	dir := t.TempDir()
	if _, _, err := EnsureCertificate(dir); err != nil {
		t.Fatalf(fmtEnsureErr, err)
	}

	info, err := os.Stat(filepath.Join(Dir(dir), keyFile))
	if err != nil {
		t.Fatalf("stat key: %v", err)
	}
	if perm := info.Mode().Perm(); perm != keyMode {
		t.Errorf("key mode = %04o, want %04o", perm, keyMode)
	}

	dirInfo, err := os.Stat(Dir(dir))
	if err != nil {
		t.Fatalf("stat dir: %v", err)
	}
	if perm := dirInfo.Mode().Perm(); perm != dirMode {
		t.Errorf("tls directory mode = %04o, want %04o", perm, dirMode)
	}
}

// TestRegenerationResetsKeyPermissions guards the case where a key already
// exists with loose permissions: writing over it must not inherit them.
func TestRegenerationResetsKeyPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permission bits are not modeled on Windows")
	}

	dir := t.TempDir()
	if err := os.MkdirAll(Dir(dir), dirMode); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	keyPath := filepath.Join(Dir(dir), keyFile)
	if err := os.WriteFile(keyPath, []byte("not a key"), 0o644); err != nil {
		t.Fatalf("seed key: %v", err)
	}

	if _, _, err := EnsureCertificate(dir); err != nil {
		t.Fatalf(fmtEnsureErr, err)
	}

	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("stat key: %v", err)
	}
	if perm := info.Mode().Perm(); perm != keyMode {
		t.Errorf("key mode after regeneration = %04o, want %04o", perm, keyMode)
	}
}

// TestEnsureCertificateReusesExistingPair verifies that a second call does not
// hand out a different certificate, which would invalidate a pinned
// fingerprint on every start.
func TestEnsureCertificateReusesExistingPair(t *testing.T) {
	dir := t.TempDir()

	_, first, err := EnsureCertificate(dir)
	if err != nil {
		t.Fatalf(fmtEnsureErr, err)
	}
	_, second, err := EnsureCertificate(dir)
	if err != nil {
		t.Fatalf("EnsureCertificate (second call): %v", err)
	}
	if first != second {
		t.Errorf("fingerprint changed on reuse: %s then %s", first, second)
	}
}

// TestEnsureCertificateReplacesUnusablePairs covers the three reasons an
// existing pair is thrown away: it does not parse, it is nearly expired, or
// the key does not belong to the certificate.
func TestEnsureCertificateReplacesUnusablePairs(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T, dir string) string
	}{
		{
			name: "corrupt files",
			setup: func(t *testing.T, dir string) string {
				t.Helper()
				writePair(t, dir, []byte("garbage"), []byte("garbage"))
				return ""
			},
		},
		{
			name: "inside the renewal window",
			setup: func(t *testing.T, dir string) string {
				t.Helper()
				return writeCertValidFor(t, dir, renewBefore-24*time.Hour)
			},
		},
		{
			name: "comfortably valid",
			setup: func(t *testing.T, dir string) string {
				t.Helper()
				return writeCertValidFor(t, dir, renewBefore+90*24*time.Hour)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			existing := tt.setup(t, dir)

			_, fp, err := EnsureCertificate(dir)
			if err != nil {
				t.Fatalf(fmtEnsureErr, err)
			}
			reused := existing != "" && fp == existing
			wantReuse := tt.name == "comfortably valid"
			if reused != wantReuse {
				t.Errorf("reused = %v, want %v", reused, wantReuse)
			}
		})
	}
}

// writePair writes raw certificate and key bytes into the tls directory.
func writePair(t *testing.T, dir string, certPEM, keyPEM []byte) {
	t.Helper()
	if err := os.MkdirAll(Dir(dir), dirMode); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(Dir(dir), certFile), certPEM, certMode); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	if err := os.WriteFile(filepath.Join(Dir(dir), keyFile), keyPEM, keyMode); err != nil {
		t.Fatalf("write key: %v", err)
	}
}

// writeCertValidFor installs a self-signed pair that expires after d and
// returns its fingerprint.
func writeCertValidFor(t *testing.T, dir string, d time.Duration) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(d),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	writePair(t, dir,
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}),
	)
	return fingerprint(der)
}
