import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Single Dio client for the whole app, mirroring web/src/lib/api.ts:
/// every request automatically gets the Sanctum bearer token and the
/// active organization header (X-Organization-Id) - see
/// backend/app/Http/Middleware/ResolveOrganization.php for why that header
/// is required on every tenant-scoped endpoint. Token/org id are read from
/// secure storage rather than kept only in memory, so a relaunch doesn't
/// require logging in again (docs/07 section 7.2 "secure cached downloads").
class ApiClient {
  ApiClient._internal() {
    _dio = Dio(
      BaseOptions(
        baseUrl: const String.fromEnvironment(
          'API_URL',
          defaultValue: 'http://10.0.2.2:8123/api/v1',
        ),
        headers: {'Accept': 'application/json'},
      ),
    );

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          final token = await _storage.read(key: 'token');
          final organizationId = await _storage.read(key: 'organization_id');

          if (token != null) {
            options.headers['Authorization'] = 'Bearer $token';
          }
          if (organizationId != null) {
            options.headers['X-Organization-Id'] = organizationId;
          }

          handler.next(options);
        },
        onError: (error, handler) async {
          if (error.response?.statusCode == 401) {
            await _storage.delete(key: 'token');
          }
          handler.next(error);
        },
      ),
    );
  }

  static final ApiClient instance = ApiClient._internal();

  late final Dio _dio;
  final _storage = const FlutterSecureStorage();

  Dio get dio => _dio;

  Future<void> saveSession(String token, String organizationId) async {
    await _storage.write(key: 'token', value: token);
    await _storage.write(key: 'organization_id', value: organizationId);
  }

  Future<void> switchOrganization(String organizationId) async {
    await _storage.write(key: 'organization_id', value: organizationId);
  }

  Future<String?> get token => _storage.read(key: 'token');

  Future<void> clearSession() async {
    await _storage.delete(key: 'token');
    await _storage.delete(key: 'organization_id');
  }
}

/// Mirrors the API's standard error envelope (docs/04 section 4.4).
String apiErrorMessage(Object error, {String fallback = 'Something went wrong.'}) {
  if (error is DioException) {
    final data = error.response?.data;
    if (data is Map) {
      final errors = data['errors'];
      if (errors is Map && errors.isNotEmpty) {
        final first = errors.values.first;
        if (first is List && first.isNotEmpty) return first.first.toString();
      }
      if (data['message'] is String) return data['message'] as String;
    }
  }
  return fallback;
}
