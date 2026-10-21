import 'dart:io';
import 'package:dio/dio.dart';
import 'api_client.dart';
import '../models/models.dart';

/// Thin wrapper over the Dio client for every project-scoped endpoint this
/// app's screens need. Kept as plain static methods rather than a heavier
/// repository/BLoC layer to match the rest of the MVP's pragmatic scope.
class ProjectApi {
  static Dio get _dio => ApiClient.instance.dio;

  // See PageMeta's doc comment: the paginator's fields (current_page,
  // last_page, total, ...) sit at the same top level as `data`, not nested
  // under a `meta` key - this reads both from that one flat map.
  static Paginated<T> _paginated<T>(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromJson,
  ) {
    return Paginated(
      data: (json['data'] as List).map((e) => fromJson(e as Map<String, dynamic>)).toList(),
      meta: PageMeta.fromJson(json),
    );
  }

  static Future<Paginated<Project>> listProjects({int page = 1}) async {
    final response = await _dio.get('/projects', queryParameters: {'page': page});
    return _paginated(response.data as Map<String, dynamic>, Project.fromJson);
  }

  static Future<Project> createProject(String name) async {
    final response = await _dio.post('/projects', data: {'name': name});
    return Project.fromJson(response.data['data']);
  }

  static Future<UsageSummary> usage() async {
    final response = await _dio.get('/usage');
    return UsageSummary.fromJson(response.data['data']);
  }

  static Future<Paginated<ReaderDocument>> listDocuments(String projectId, {int page = 1}) async {
    final response = await _dio.get(
      '/projects/$projectId/documents',
      queryParameters: {'page': page},
    );
    return _paginated(response.data as Map<String, dynamic>, ReaderDocument.fromJson);
  }

  static Future<ReaderDocument> uploadDocument(String projectId, File file) async {
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(file.path, filename: file.path.split('/').last),
    });
    final response = await _dio.post('/projects/$projectId/documents', data: form);
    return ReaderDocument.fromJson(response.data['data']);
  }

  static Future<List<int>> downloadDocumentBytes(String documentId) async {
    final response = await _dio.get<List<int>>(
      '/documents/$documentId/download',
      options: Options(responseType: ResponseType.bytes),
    );
    return response.data!;
  }

  static Future<Paginated<Excerpt>> listExcerpts(String projectId, {int page = 1}) async {
    final response = await _dio.get(
      '/projects/$projectId/excerpts',
      queryParameters: {'page': page},
    );
    return _paginated(response.data as Map<String, dynamic>, Excerpt.fromJson);
  }

  static Future<Paginated<ResearchNote>> listNotes(String projectId, {int page = 1}) async {
    final response = await _dio.get('/projects/$projectId/notes', queryParameters: {'page': page});
    return _paginated(response.data as Map<String, dynamic>, ResearchNote.fromJson);
  }

  static Future<ResearchNote> createNote(String projectId, String content) async {
    final response = await _dio.post('/projects/$projectId/notes', data: {'content': content});
    return ResearchNote.fromJson(response.data['data']);
  }

  static Future<Map<String, dynamic>> startExport(String projectId) async {
    final response = await _dio.post('/projects/$projectId/exports');
    return response.data['data'] as Map<String, dynamic>;
  }

  static Future<Map<String, dynamic>> exportStatus(String exportId) async {
    final response = await _dio.get('/exports/$exportId');
    return response.data['data'] as Map<String, dynamic>;
  }
}
