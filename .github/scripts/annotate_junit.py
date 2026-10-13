"""Turn the failed tests of a JUnit report into GitHub annotations.

A job's log can only be read after signing in to GitHub; its annotations
show on the run's page and in the API for everyone. So a failed run says
which test failed and why without anyone opening the log.

    python3 .github/scripts/annotate_junit.py junit.xml
"""

import os
import sys
import xml.etree.ElementTree as ET

# GitHub keeps ten annotations of each level per step.
MAX_ERRORS = 9
MAX_CHARS = 1800


def data(text):
    """Escape a workflow-command message."""
    return text.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')


def prop(text):
    """Escape a workflow-command property (file, title)."""
    return data(text).replace(':', '%3A').replace(',', '%2C')


def main(path):
    if not os.path.exists(path):
        print('::error title=Tests::No JUnit report was written (%s): the run stopped before any test finished. Look at the log.' % data(path))
        return

    root = os.getcwd().replace('\\', '/').rstrip('/') + '/'
    broken = []
    for case in ET.parse(path).getroot().iter('testcase'):
        for kind in ('error', 'failure'):
            for problem in case.findall(kind):
                broken.append((case, kind, problem))

    for case, kind, problem in broken[:MAX_ERRORS]:
        file = (case.get('file') or '').replace('\\', '/')
        if file.startswith(root):
            file = file[len(root):]
        name = '%s::%s' % ((case.get('class') or case.get('classname') or '?').split('\\')[-1], case.get('name') or '?')
        text = ((problem.get('message') or '') + '\n' + (problem.text or '')).strip()
        if len(text) > MAX_CHARS:
            text = text[:MAX_CHARS] + '\n(cut)'
        where = 'file=%s,line=%s,' % (prop(file), case.get('line') or '1') if file else ''
        print('::error %stitle=%s::%s' % (where, prop(name), data('[%s] %s' % (kind, text))))

    if len(broken) > MAX_ERRORS:
        rest = ', '.join(case.get('name') or '?' for case, _, _ in broken[MAX_ERRORS:])
        print('::warning title=Tests::%d more failed tests: %s' % (len(broken) - MAX_ERRORS, data(rest[:MAX_CHARS])))
    if not broken:
        print('::error title=Tests::The run failed but the JUnit report lists no failed test. Look at the log.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'junit.xml')
