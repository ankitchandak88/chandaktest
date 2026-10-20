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

class Excerpt {
  final String id;
  final String documentId;
  final int pageNumber;
  final String text;

  Excerpt({
    required this.id,
    required this.documentId,
    required this.pageNumber,
    required this.text,
  });

  factory Excerpt.fromJson(Map<String, dynamic> json) => Excerpt(
        id: json['id'] as String,
        documentId: json['document_id'] as String,
        pageNumber: json['page_number'] as int,
        text: json['text'] as String,
      );
}

class ResearchNote {
  final String id;
  final String? title;
  final String? content;

  ResearchNote({required this.id, this.title, this.content});

  factory ResearchNote.fromJson(Map<String, dynamic> json) => ResearchNote(
        id: json['id'] as String,
        title: json['title'] as String?,
        content: json['content'] as String?,
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
