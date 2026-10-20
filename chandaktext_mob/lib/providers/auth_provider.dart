import 'package:flutter/foundation.dart';
import '../api/api_client.dart';
import '../models/models.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

/// Holds the signed-in user + organization list. `bootstrap()` runs once at
/// app start to restore a session from secure storage (see ApiClient) so a
/// relaunch doesn't force a fresh login.
class AuthProvider extends ChangeNotifier {
  AuthStatus status = AuthStatus.unknown;
  AuthUser? user;
  List<OrganizationSummary> organizations = [];
  String? activeOrganizationId;

  Future<void> bootstrap() async {
    final token = await ApiClient.instance.token;
    if (token == null) {
      status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }

    try {
      await _loadMe();
      status = AuthStatus.authenticated;
    } catch (_) {
      await ApiClient.instance.clearSession();
      status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<void> login(String email, String password) async {
    final response = await ApiClient.instance.dio.post(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    final data = response.data['data'];
    user = AuthUser.fromJson(data['user']);

    await ApiClient.instance.saveSession(data['token'] as String, '');
    await _loadMe();
    status = AuthStatus.authenticated;
    notifyListeners();
  }

  Future<void> register(String name, String email, String password) async {
    final response = await ApiClient.instance.dio.post(
      '/auth/register',
      data: {
        'name': name,
        'email': email,
        'password': password,
        'password_confirmation': password,
      },
    );
    final data = response.data['data'];
    user = AuthUser.fromJson(data['user']);

    await ApiClient.instance.saveSession(
      data['token'] as String,
      data['organization_id'] as String,
    );
    await _loadMe();
    status = AuthStatus.authenticated;
    notifyListeners();
  }

  Future<void> _loadMe() async {
    final response = await ApiClient.instance.dio.get('/me');
    final data = response.data['data'];
    user = AuthUser.fromJson(data);

    final memberships = (data['memberships'] as List)
        .map((m) => OrganizationSummary.fromMembershipJson(m as Map<String, dynamic>))
        .toList();
    organizations = memberships;

    activeOrganizationId ??= memberships.isNotEmpty ? memberships.first.id : null;
    if (activeOrganizationId != null) {
      await ApiClient.instance.switchOrganization(activeOrganizationId!);
    }
  }

  Future<void> setActiveOrganization(String organizationId) async {
    activeOrganizationId = organizationId;
    await ApiClient.instance.switchOrganization(organizationId);
    notifyListeners();
  }

  Future<void> logout() async {
    await ApiClient.instance.clearSession();
    user = null;
    organizations = [];
    activeOrganizationId = null;
    status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
