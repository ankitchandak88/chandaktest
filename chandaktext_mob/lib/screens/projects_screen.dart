import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';
import '../providers/auth_provider.dart';
import 'project_detail_screen.dart';

class ProjectsScreen extends StatefulWidget {
  const ProjectsScreen({super.key});

  @override
  State<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends State<ProjectsScreen> {
  late Future<List<Project>> _projects;
  UsageSummary? _usage;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    _projects = ProjectApi.listProjects();
    ProjectApi.usage().then((u) {
      if (mounted) setState(() => _usage = u);
    }).catchError((_) {});
  }

  Future<void> _createProject() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New project'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Project name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Create'),
          ),
        ],
      ),
    );

    if (name == null || name.isEmpty) return;

    try {
      await ProjectApi.createProject(name);
      setState(_load);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(apiErrorMessage(err))),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Projects'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => context.read<AuthProvider>().logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _createProject,
        child: const Icon(Icons.add),
      ),
      body: RefreshIndicator(
        onRefresh: () async => setState(_load),
        child: FutureBuilder<List<Project>>(
          future: _projects,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError) {
              return Center(child: Text(apiErrorMessage(snapshot.error!)));
            }

            final projects = snapshot.data ?? [];

            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_usage != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      '${_usage!.projectsUsed} / ${_usage!.projectsLimit} projects on the '
                      '${_usage!.plan} plan',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                if (projects.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: Center(child: Text('No projects yet. Tap + to create one.')),
                  ),
                for (final project in projects)
                  Card(
                    child: ListTile(
                      title: Text(project.name),
                      subtitle: Text(
                        '${project.documentsCount} documents · ${project.excerptsCount} excerpts · '
                        '${project.notesCount} notes',
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () async {
                        // Document/excerpt/note counts can change while the
                        // user is inside the project (upload, add note,
                        // etc.) - refresh this list on return rather than
                        // showing stale counts indefinitely.
                        await Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => ProjectDetailScreen(project: project)),
                        );
                        if (mounted) setState(_load);
                      },
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
