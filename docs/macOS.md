# macOS Troubleshooting

## Gatekeeper Warning ("App is damaged" / cannot be opened)

Encounty is not signed with an Apple Developer certificate.
macOS may block the app on first launch.
### Option 1: Remove quarantine attribute (recommended)

```bash
xattr -rd com.apple.quarantine /Applications/Encounty.app
```

### Option 2: Open via System Settings

1. Try to open the app
2. Go to System Settings → Privacy & Security
3. Click "Open Anyway"

### Why this happens

macOS uses a security feature called Gatekeeper to ensure apps are signed by identified developers.
Since Encounty is open source and not code signed, you need to manually allow it.

### Security Note
Only do this if you trust the source of the application.

You can verify the code [here](https://github.com/ZSleyer/Encounty)
