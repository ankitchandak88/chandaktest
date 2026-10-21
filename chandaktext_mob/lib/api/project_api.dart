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

  static Future<ReaderDocument> updateDocumentCitation(
    String documentId,
    Map<String, dynamic>? citationMetadata,
  ) async {
    final response = await _dio.patch(
      '/documents/$documentId',
      data: {'citation_metadata': citationMetadata},
    );
    return ReaderDocument.fromJson(response.data['data'] as Map<String, dynamic>);
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

  // Unpaginated, like links below - same precedent as the web app
  // (Links/WorkspaceItems endpoints return the full list, see
  // backend/routes/api/v1.php).
  static Future<List<WorkspaceItem>> listWorkspaceItems(String projectId) async {
    final response = await _dio.get('/projects/$projectId/workspace-items');
    return (response.data['data'] as List)
        .map((e) => WorkspaceItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> saveWorkspaceBatch(
    String projectId,
    List<Map<String, dynamic>> items,
  ) async {
    await _dio.post('/projects/$projectId/workspace-items/batch', data: {'items': items});
  }

  static Future<List<ProjectLink>> listLinks(String projectId) async {
    final response = await _dio.get('/projects/$projectId/links');
    return (response.data['data'] as List)
        .map((e) => ProjectLink.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> createLink(
    String projectId, {
    required String sourceType,
    required String sourceId,
    required String targetType,
    required String targetId,
  }) async {
    await _dio.post('/projects/$projectId/links', data: {
      'source_type': sourceType,
      'source_id': sourceId,
      'target_type': targetType,
      'target_id': targetId,
    });
  }

  // Unpaginated, same precedent as workspace-items/links above.
  static Future<List<Tag>> listTags(String projectId) async {
    final response = await _dio.get('/projects/$projectId/tags');
    return (response.data['data'] as List)
        .map((e) => Tag.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<Tag> createTag(String projectId, String name) async {
    final response = await _dio.post('/projects/$projectId/tags', data: {'name': name});
    return Tag.fromJson(response.data['data'] as Map<String, dynamic>);
  }

  static Future<void> deleteTag(String tagId) async {
    await _dio.delete('/tags/$tagId');
  }

  static Future<List<Tag>> syncExcerptTags(String excerptId, List<String> tagIds) async {
    final response = await _dio.put('/excerpts/$excerptId/tags', data: {'tag_ids': tagIds});
    return Excerpt.fromJson(response.data['data'] as Map<String, dynamic>).tags;
  }

  static Future<List<Tag>> syncNoteTags(String noteId, List<String> tagIds) async {
    final response = await _dio.put('/notes/$noteId/tags', data: {'tag_ids': tagIds});
    return ResearchNote.fromJson(response.data['data'] as Map<String, dynamic>).tags;
  }
}
