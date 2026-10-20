import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/auth_provider.dart';
import 'screens/login_screen.dart';
import 'screens/projects_screen.dart';

void main() {
  runApp(const ChandakTextApp());
}

class ChandakTextApp extends StatefulWidget {
  const ChandakTextApp({super.key});

  @override
  State<ChandakTextApp> createState() => _ChandakTextAppState();
}

class _ChandakTextAppState extends State<ChandakTextApp> {
  late final AuthProvider _authProvider;

  @override
  void initState() {
    super.initState();
    _authProvider = AuthProvider();
    _authProvider.bootstrap();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider.value(
      value: _authProvider,
      child: MaterialApp(
        title: 'ChandakText',
        debugShowCheckedModeBanner: false,
        // Same dark-slate-shell + cyan-accent direction as the web app
        // (docs/05 section 5.1).
        theme: ThemeData(
          brightness: Brightness.dark,
          scaffoldBackgroundColor: const Color(0xFF020617),
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF22D3EE),
            brightness: Brightness.dark,
          ),
          appBarTheme: const AppBarTheme(backgroundColor: Color(0xFF0F172A)),
          cardTheme: const CardThemeData(color: Color(0xFF0F172A)),
          useMaterial3: true,
        ),
        home: Consumer<AuthProvider>(
          builder: (context, auth, _) {
            switch (auth.status) {
              case AuthStatus.unknown:
                return const Scaffold(body: Center(child: CircularProgressIndicator()));
              case AuthStatus.unauthenticated:
                return const LoginScreen();
              case AuthStatus.authenticated:
                return const ProjectsScreen();
            }
          },
        ),
      ),
    );
  }
}
