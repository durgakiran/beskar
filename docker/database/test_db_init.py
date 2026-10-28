"""Exercise the init entrypoint without connecting to a database or downloading tools."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DatabaseInitTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / 'db', self.root / 'db', ignore=shutil.ignore_patterns('liquibase-temp.properties*'))
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.install(self.bin / 'pg_isready', '#!/bin/sh\nprintf "%s\\n" "$*" > "$READY_LOG"\n')
        self.install(self.root / 'docker/database/liquibasebin/liquibase', '''#!/usr/bin/env python3
import json, os
from pathlib import Path
import sys
properties = Path('liquibase-temp.properties').read_text()
with open(os.environ['MIGRATION_LOG'], 'a') as log:
    log.write(json.dumps({'directory': Path.cwd().name, 'args': sys.argv[1:], 'properties': properties}) + '\\n')
if os.environ.get('FAIL_SEARCH') and 'changeLogFile=search.xml' in properties and sys.argv[-1] == 'update':
    sys.exit(42)
''')
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        DB_HOST='custom-postgres', DB_PORT='6543', DB_SEARCH_NAME='search_test',
                        DB_SEARCH_WRITER_USER='search_test_writer',
                        DB_SEARCH_WRITER_USER_PWD="test/'secret&|\\value",
                        MIGRATION_LOG=str(self.root / 'migrations.jsonl'), READY_LOG=str(self.root / 'ready.log'))

    def install(self, path, source):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        path.chmod(0o700)

    def run_init(self):
        return subprocess.run(['bash', str(ROOT / 'docker/database/db-init.sh')], cwd=self.root,
                              env=self.env, capture_output=True, text=True)

    def calls(self):
        return [json.loads(line) for line in (self.root / 'migrations.jsonl').read_text().splitlines()]

    def assert_cleaned(self):
        self.assertEqual(list((self.root / 'db').rglob('liquibase-temp.properties*')), [])

    def test_initialization_order_and_configuration(self):
        result = self.run_init()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertEqual([c['directory'] for c in calls], ['init'] * 6 + ['beskar'] * 2 + ['search'] * 2)
        self.assertEqual([c['args'][1] for c in calls], ['update', 'tag'] * 5)
        init = calls[4]['properties']
        self.assertIn('changeLogFile=search.xml', init)
        self.assertIn('parameter.search_database_name=search_test', init)
        self.assertIn("parameter.search_writer_pwd=test/''secret&|\\\\value", init)
        target = calls[8]['properties']
        self.assertIn('jdbc:postgresql://custom-postgres:6543/search_test', target)
        self.assertIn('liquibase.command.username=admin', target)
        self.assertIn('parameter.search_writer=search_test_writer', target)
        self.assertNotIn('@DB_', ''.join(c['properties'] for c in calls))
        self.assertEqual((self.root / 'ready.log').read_text().strip(), '-h custom-postgres -p 6543')
        self.assertNotIn(self.env['DB_SEARCH_WRITER_USER_PWD'], result.stdout + result.stderr)
        self.assert_cleaned()

    def test_failed_search_provisioning_stops_later_migrations(self):
        self.env['FAIL_SEARCH'] = '1'
        result = self.run_init()
        self.assertEqual(result.returncode, 42)
        self.assertEqual(len(self.calls()), 5)
        self.assertNotIn('databases initialised with schema', result.stdout)
        self.assert_cleaned()

    def test_search_database_must_be_separate(self):
        self.env['DB_SEARCH_NAME'] = 'beskar'
        result = self.run_init()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Search must use a separate database', result.stderr)
        self.assertFalse((self.root / 'migrations.jsonl').exists())


if __name__ == '__main__':
    unittest.main()
