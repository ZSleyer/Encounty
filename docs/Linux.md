# Linux Troubleshooting

## AppImage fails to start (missing libz.so)

The app exits immediately with `error while loading shared libraries: libz.so: cannot
open shared object file`.

The AppImage runtime links the **unversioned** `libz.so`. The base zlib package only
provides `libz.so.1`; the unversioned symlink ships in the zlib development package, so a
minimal system may be missing it.

### Fix

Install the package that provides `libz.so` for your distribution:

| Distribution                      | Package      |
|-----------------------------------|--------------|
| Debian / Ubuntu (and derivatives) | `zlib1g-dev` |
| Fedora / RHEL / openSUSE          | `zlib-devel` |
| Arch (and derivatives)            | `zlib`       |

For example, on Debian:

```bash
sudo apt install zlib1g-dev
```

On Arch, the `zlib` package already provides `libz.so`, so reinstall it only if the file
is missing:

```bash
sudo pacman -S zlib
```

### Why this happens

The bundled AppImage runtime declares a dependency on the unversioned `libz.so` name
rather than the versioned `libz.so.1` that ships with the base zlib package. The
unversioned symlink is part of the zlib development package on most distributions, so on a
minimal install the runtime cannot start until it is present.
