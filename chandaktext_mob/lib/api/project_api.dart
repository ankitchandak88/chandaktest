import 'dart:io';
import 'package:dio/dio.dart';
import 'api_client.dart';
import '../models/models.dart';

/// Thin wrapper over the Dio client for every project-scoped endpoint this
/// app's screens need. Kept as plain static methods rather than a heavier
/// repository/BLoC layer to match the rest of the MVP's pragmatic scope.
class ProjectApi {
  static Dio get _dio => ApiClient.instance.dio;

  static Future<List<Project>> listProjects() async {
    final response = await _dio.get('/projects');
    return (response.data['data'] as List)
        .map((e) => Project.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<Project> createProject(String name) async {
    final response = await _dio.post('/projects', data: {'name': name});
    return Project.fromJson(response.data['data']);
  }

  static Future<UsageSummary> usage() async {
    final response = await _dio.get('/usage');
    return UsageSummary.fromJson(response.data['data']);
  }

  static Future<List<ReaderDocument>> listDocuments(String projectId) async {
    final response = await _dio.get('/projects/$projectId/documents');
    return (response.data['data'] as List)
        .map((e) => ReaderDocument.fromJson(e as Map<String, dynamic>))
        .toList();
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

  static Future<List<Excerpt>> listExcerpts(String projectId) async {
    final response = await _dio.get('/projects/$projectId/excerpts');
    return (response.data['data'] as List)
        .map((e) => Excerpt.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<ResearchNote>> listNotes(String projectId) async {
    final response = await _dio.get('/projects/$projectId/notes');
    return (response.data['data'] as List)
        .map((e) => ResearchNote.fromJson(e as Map<String, dynamic>))
        .toList();
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
