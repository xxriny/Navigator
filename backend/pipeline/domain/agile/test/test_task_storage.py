"""All Agile entry points must observe the configured local task database."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class TaskStorageTests(unittest.TestCase):
    def test_coordinator_and_approval_sessions_use_configured_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'isolated.db'
            database_url = 'sqlite:///' + path.as_posix()
            env = {**os.environ, 'NAVIGATOR_STORAGE_DIR': directory,
                   'NAVIGATOR_LOCAL_DATABASE_URL': database_url, 'PYTHONDONTWRITEBYTECODE':'1'}
            script = '''
import os
from auth import database
from pipeline.domain.agile import task_coordinator as coordinator
# Check destination before any create_all/insert; never touch production storage.
assert str(coordinator._engine.url) == os.environ['NAVIGATOR_LOCAL_DATABASE_URL'], 'coordinator ignores configured database'
assert coordinator._engine is database.engine, 'two independently configured engines'
coordinator.init_tasks_db()
with database.SessionLocal() as db:
    db.add(coordinator.AgileTask(id='approved', title='Approved', task_type='feature', team_id='team', status='unassigned'))
    db.commit()
assert [row['id'] for row in coordinator.list_tasks(team_id='team')] == ['approved']
created = coordinator.create_task(task_type='feature', title='Manual', team_id='team', status='unassigned')
with database.SessionLocal() as db:
    assert db.get(coordinator.AgileTask, created['id']).title == 'Manual'
database.engine.dispose()
'''
            result = subprocess.run([sys.executable, '-c', script], env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr[-3000:])


if __name__ == '__main__':
    unittest.main()
