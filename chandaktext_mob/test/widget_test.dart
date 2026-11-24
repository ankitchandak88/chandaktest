// Smoke test: the app boots to the login screen when unauthenticated.
//
// flutter_secure_storage talks to a platform channel that isn't wired up
// in the widget-test environment, so AuthProvider.bootstrap()'s read would
// throw a MissingPluginException; this mocks that channel to simply return
// null (no stored session), matching a fresh install.
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:chandaktext_mob/main.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (call) async {
    if (call.method == 'read') return null;
    return null;
  });

  testWidgets('shows the login screen on a fresh launch', (WidgetTester tester) async {
    await tester.pumpWidget(const ChandakTextApp());
    await tester.pumpAndSettle();

    expect(find.text('ChandakText'), findsOneWidget);
    expect(find.text('Log in to your research workspace.'), findsOneWidget);
  });
}
