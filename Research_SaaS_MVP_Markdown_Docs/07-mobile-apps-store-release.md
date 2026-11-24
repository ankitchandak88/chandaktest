# 7. Mobile Apps and Store Release

## 7.1 Strategy

Use Flutter for Android and iOS, with shared API contracts and domain behavior. Do not merely embed the web app in a WebView. PDF rendering, selection, touch controls, accessibility, and performance require device-level implementation and testing.

## 7.2 Initial mobile scope

- Sign up/login/recovery
- Project list and project details
- PDF reading, zoom and page navigation
- Highlights, underlines, and comments
- Create/view excerpts and notes
- Access saved workspace state
- Search document text
- Account and privacy controls
- Plan/usage display
- Secure cached downloads and offline behavior where supported

Advanced canvas gestures and real-time collaboration can be staged after the first release if necessary.

## 7.3 Android release checklist

- Create and verify developer account.
- Set application ID, app signing, versioning, and release configuration.
- Produce signed Android App Bundle (`.aab`).
- Test on supported Android versions and representative screen sizes.
- Test network interruptions, low-memory conditions, file access, and accessibility.
- Prepare icon, screenshots, description, support contact, and privacy policy.
- Complete Data safety, content-rating, target audience, and other required declarations.
- Meet the applicable testing-track and new-account requirements.
- Submit for review and monitor review feedback.

## 7.4 Apple release checklist

- Enroll in Apple Developer Program.
- Configure bundle identifier, signing, provisioning, and entitlements.
- Build and archive the app; upload through Xcode or Transporter.
- Test on supported iPhones and iPads.
- Configure App Store Connect listing, screenshots, support URL, and privacy disclosures.
- Check Sign in with Apple requirements if third-party sign-in is provided.
- Check digital purchase rules and required purchase APIs.
- Provide reviewer notes and test access if required.
- Submit and respond to review feedback.

## 7.5 Mobile test matrix

| Area | Checks |
|---|---|
| Install/update | Fresh install, upgrade, launch, migration |
| Authentication | Login, logout, expired session |
| PDF | Open, navigate, zoom, selection, large files |
| Annotation | Create, save, reopen, coordinate alignment |
| Network | Slow connection, offline, reconnect |
| Storage | Cache expiry, private files, deletion |
| Accessibility | Dynamic text where applicable, screen readers, focus |
| Billing | Entitlement state, renewal/cancel state, restored purchase where applicable |
| Privacy | Account deletion, consent, disclosure consistency |
| Stability | Crash-free test sessions and memory behavior |

## 7.6 Release caveat

Store submission does not guarantee approval. Re-check current Android target SDK, Apple SDK, developer-account requirements, billing rules, privacy declarations, and review guidelines at release time. Keep signed release credentials secure and outside source control.
