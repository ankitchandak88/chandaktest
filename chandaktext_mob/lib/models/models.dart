/// Pagination metadata. The backend's paginated endpoints (Project/
/// Document/Excerpt/Note controllers) return `response()->json($paginator)`
/// directly, i.e. Laravel's native flat LengthAwarePaginator shape -
/// current_page/last_page/total etc. sit at the TOP LEVEL alongside `data`,
/// there is no nested `meta` object (confirmed against a live response,
/// not assumed from the in-code comments claiming otherwise).
class PageMeta {
  final int currentPage;
  final int lastPage;
  final int total;

  PageMeta({required this.currentPage, required this.lastPage, required this.total});

  factory PageMeta.fromJson(Map<String, dynamic> json) => PageMeta(
        currentPage: json['current_page'] as int,
        lastPage: json['last_page'] as int,
        total: json['total'] as int,
      );

  bool get hasMore => currentPage < lastPage;
}

class Paginated<T> {
  final List<T> data;
  final PageMeta meta;

  Paginated({required this.data, required this.meta});
}

class AuthUser {
  final int id;
  final String name;
  final String email;

  AuthUser({required this.id, required this.name, required this.email});

  factory AuthUser.fromJson(Map<String, dynamic> json) => AuthUser(
        id: json['id'] as int,
        name: json['name'] as String,
        email: json['email'] as String,
      );
}

class OrganizationSummary {
  final String id;
  final String name;
  final String role;

  OrganizationSummary({required this.id, required this.name, required this.role});

  factory OrganizationSummary.fromMembershipJson(Map<String, dynamic> json) =>
      OrganizationSummary(
        id: json['organization']['id'] as String,
        name: json['organization']['name'] as String,
        role: json['role'] as String,
      );
}

class Project {
  final String id;
  final String name;
  final String? description;
  final int documentsCount;
  final int notesCount;
  final int excerptsCount;

  Project({
    required this.id,
    required this.name,
    this.description,
    this.documentsCount = 0,
    this.notesCount = 0,
    this.excerptsCount = 0,
  });

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        documentsCount: (json['documents_count'] as int?) ?? 0,
        notesCount: (json['notes_count'] as int?) ?? 0,
        excerptsCount: (json['excerpts_count'] as int?) ?? 0,
      );
}

class ReaderDocument {
  final String id;
  final String projectId;
  final String originalFilename;
  final int? pageCount;
  final String status;
  final String? failureReason;

  ReaderDocument({
    required this.id,
    required this.projectId,
    required this.originalFilename,
    required this.status,
    this.pageCount,
    this.failureReason,
  });

  factory ReaderDocument.fromJson(Map<String, dynamic> json) => ReaderDocument(
        id: json['id'] as String,
        projectId: json['project_id'] as String,
        originalFilename: json['original_filename'] as String,
        pageCount: json['page_count'] as int?,
        status: json['status'] as String,
        failureReason: json['failure_reason'] as String?,
      );
}

class Tag {
  final String id;
  final String name;

  Tag({required this.id, required this.name});

  factory Tag.fromJson(Map<String, dynamic> json) => Tag(
        id: json['id'] as String,
        name: json['name'] as String,
      );
}

List<Tag> _tagsFromJson(Map<String, dynamic> json) =>
    (json['tags'] as List?)?.map((t) => Tag.fromJson(t as Map<String, dynamic>)).toList() ?? [];

class Excerpt {
  final String id;
  final String documentId;
  final int pageNumber;
  final String text;
  final List<Tag> tags;

  Excerpt({
    required this.id,
    required this.documentId,
    required this.pageNumber,
    required this.text,
    this.tags = const [],
  });

  factory Excerpt.fromJson(Map<String, dynamic> json) => Excerpt(
        id: json['id'] as String,
        documentId: json['document_id'] as String,
        pageNumber: json['page_number'] as int,
        text: json['text'] as String,
        tags: _tagsFromJson(json),
      );
}

class ResearchNote {
  final String id;
  final String? title;
  final String? content;
  final List<Tag> tags;

  ResearchNote({required this.id, this.title, this.content, this.tags = const []});

  factory ResearchNote.fromJson(Map<String, dynamic> json) => ResearchNote(
        id: json['id'] as String,
        title: json['title'] as String?,
        content: json['content'] as String?,
        tags: _tagsFromJson(json),
      );
}

/// A card's position/size on the project canvas (Phase 7: mobile canvas
/// editing, matching web/src/components/WorkspaceCanvas.tsx). `itemType`
/// + `targetId` identify which Excerpt or ResearchNote this card renders -
/// the same typed-pair pattern the backend uses instead of a raw
/// polymorphic FK (see backend's CleansUpWorkspaceReferences doc comment).
class WorkspaceItem {
  final String id;
  final String itemType; // 'excerpt' | 'note'
  final String targetId;
  final double x;
  final double y;
  final double width;
  final double height;

  WorkspaceItem({
    required this.id,
    required this.itemType,
    required this.targetId,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  factory WorkspaceItem.fromJson(Map<String, dynamic> json) => WorkspaceItem(
        id: json['id'] as String,
        itemType: json['item_type'] as String,
        targetId: json['target_id'] as String,
        x: (json['x'] as num).toDouble(),
        y: (json['y'] as num).toDouble(),
        width: (json['width'] as num?)?.toDouble() ?? 240,
        height: (json['height'] as num?)?.toDouble() ?? 120,
      );
}

class ProjectLink {
  final String id;
  final String sourceType;
  final String sourceId;
  final String targetType;
  final String targetId;

  ProjectLink({
    required this.id,
    required this.sourceType,
    required this.sourceId,
    required this.targetType,
    required this.targetId,
  });

  factory ProjectLink.fromJson(Map<String, dynamic> json) => ProjectLink(
        id: json['id'] as String,
        sourceType: json['source_type'] as String,
        sourceId: json['source_id'] as String,
        targetType: json['target_type'] as String,
        targetId: json['target_id'] as String,
      );
}

class UsageSummary {
  final String plan;
  final int projectsUsed;
  final int projectsLimit;
  final int storageUsedBytes;
  final int storageLimitBytes;

  UsageSummary({
    required this.plan,
    required this.projectsUsed,
    required this.projectsLimit,
    required this.storageUsedBytes,
    required this.storageLimitBytes,
  });

  factory UsageSummary.fromJson(Map<String, dynamic> json) => UsageSummary(
        plan: json['plan'] as String,
        projectsUsed: json['projects']['used'] as int,
        projectsLimit: json['projects']['limit'] as int,
        storageUsedBytes: json['storage_bytes']['used'] as int,
        storageLimitBytes: json['storage_bytes']['limit'] as int,
      );
}
