import contextlib
import http.server
import json
import socketserver
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@contextlib.contextmanager
def local_server():
    handler = lambda *args, **kwargs: QuietHandler(*args, directory=str(ROOT), **kwargs)
    with socketserver.TCPServer(('127.0.0.1', 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f'http://127.0.0.1:{server.server_address[1]}/'
        finally:
            server.shutdown()
            thread.join(timeout=3)


with local_server() as base_url, sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.set_default_timeout(120_000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base_url, wait_until='domcontentloaded', timeout=60_000)
    page.wait_for_selector('#testBtn')
    page.wait_for_timeout(900)
    page.click('#splashScreen')
    page.wait_for_selector('#loginScreen:not(.hidden)')

    visible_entry_labels = page.locator('#loginScreen .login-actions button').all_inner_texts()
    assert visible_entry_labels == ['登录', '注册', '本地使用', '测试'], visible_entry_labels
    assert page.locator('#loginScreen .login-logo').count() == 0
    assert page.locator('#loginScreen .login-copy').count() == 0

    page.click('#testBtn')
    page.wait_for_selector('#appShell:not(.hidden)')

    seeded = page.evaluate("""async () => {
      const db = await import('./src/db.js?integrity-browser=1');
      const beans = await db.all('beans');
      const bean = beans[0];
      if (!bean) throw new Error('测试数据没有豆卡');
      const session = {
        id: 'brew-integrity-browser', beanId: bean.id, createdAt: '2026-08-02T10:00:00Z',
        status: 'evaluated', profile: { id: 'one-pour', label: '一刀流' }, profileVersion: 'one-pour@test',
        stages: [
          { index: 1, name: '闷蒸', startSec: 0, durationSec: 30, stageWaterG: 45, cumulativeWaterG: 45, temperatureC: 88, flowGPerSec: 3 },
          { index: 2, name: '一刀流主萃', startSec: 30, durationSec: 100, stageWaterG: 188, cumulativeWaterG: 233, temperatureC: 91, flowGPerSec: 4.6 }
        ], totals: { doseG: 15, waterG: 233, ratio: 15.5, targetTimeSec: 130 },
        sensoryRecordId: 'sensory-integrity-browser', subjectiveScore: 86
      };
      const note = '完整札记：前段茉莉与柑橘清晰，中段蜂蜜甜感增强，低温仍有茶感和圆润口感；下一次保持一刀流，只微调研磨和尾段温度。';
      const record = {
        id: 'sensory-integrity-browser', beanId: bean.id, brewSessionId: session.id,
        createdAt: '2026-08-02T10:05:00Z', updatedAt: '2026-08-02T10:05:00Z',
        autoScore: 83, subjectiveScore: 86, score: 86, scoreDelta: 3,
        answers: {
          floral: { 0: ['茉莉'], 1: ['强'] }, fruit: { 0: ['柑橘'], 1: ['强'] },
          sweet: { 0: ['蜂蜜'], 1: ['高'] }, mouthfeel: { 0: ['圆润'] }
        },
        naturalNote: note,
        professional: {
          mode: 'professional',
          selections: { dry: ['茉莉', '柑橘'], high: ['蜂蜜'], low: ['茶感'] },
          intensities: { dry: 11, high: 9, low: 7 },
          radar: { aroma: [9, 8, 6, 3, 2], style: [8, 8, 7, 9, 6] },
          affective: { '香气 / 干湿香': 8, '风味 / 余韵': 8, '酸质': 7, '甜感': 9, '口感': 8 },
          mappedScore: 89.4
        },
        preferenceTags: ['茉莉', '柑橘', '蜂蜜']
      };
      await db.put('brewSessions', session);
      await db.put('sensoryRecords', record);

      const raw = await new Promise((resolve, reject) => {
        const request = indexedDB.open('luckybean');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction(['sensoryRecords', 'settings'], 'readonly');
          const sensoryRequest = tx.objectStore('sensoryRecords').get(record.id);
          const settingsRequest = tx.objectStore('settings').get('app.settings');
          tx.oncomplete = () => {
            database.close();
            resolve({ sensory: sensoryRequest.result, settings: settingsRequest.result });
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      return { beanId: bean.id, note, raw };
    }""")

    raw_sensory = json.dumps(seeded['raw']['sensory'], ensure_ascii=False)
    raw_settings = json.dumps(seeded['raw']['settings'], ensure_ascii=False)
    assert '完整札记' not in raw_sensory, raw_sensory
    assert '茉莉' not in raw_sensory, raw_sensory
    assert seeded['raw']['sensory'].get('encryption') == 'AES-GCM-256', seeded['raw']['sensory']
    assert '"publicId": "LB-' not in raw_settings, raw_settings
    assert seeded['raw']['settings'].get('privateIdentity', {}).get('encryption') == 'AES-GCM-256', seeded['raw']['settings']

    page.reload(wait_until='domcontentloaded')
    page.wait_for_timeout(900)
    page.click('#splashScreen')
    page.wait_for_selector('#appShell:not(.hidden)')
    assert page.locator('#loginScreen:not(.hidden)').count() == 0

    page.click('[data-page-target="brew"]')
    compact = page.locator('[data-replay-session="brew-integrity-browser"].brew-history-compact-v097')
    compact.wait_for()
    compact_text = compact.inner_text()
    assert '2026-08-02' in compact_text, compact_text
    assert '一刀流' in compact_text, compact_text
    assert '86.0' in compact_text, compact_text
    assert '复刻' in compact_text, compact_text
    assert '完整札记' not in compact_text, compact_text
    assert compact.locator(':scope > *').count() == 4
    compact_box = compact.bounding_box()
    assert compact_box and compact_box['height'] <= 50, compact_box

    page.wait_for_selector('#directSensoryBtn')
    page.click('#directSensoryBtn')
    page.wait_for_selector('#pageSensory.active .v095-sensory-modes-v2')
    modes = page.locator('#pageSensory.active [data-v095-mode] strong').all_inner_texts()
    assert modes == ['专业品鉴', '玩家互动品鉴', '札记'], modes
    assert page.locator('#pageSensory.active .sensory-evaluation').count() == 0
    for button in page.locator('#pageSensory.active [data-v095-mode]').all():
        alignment = button.evaluate("node => getComputedStyle(node).textAlign")
        assert alignment == 'center', alignment

    page.click('#sensoryHistoryToggle')
    page.wait_for_selector('.sensory-history .sensory-record-card')
    history_text = page.locator('.sensory-history .sensory-record-card').first.inner_text()
    assert '茉莉' in history_text, history_text
    assert '柑橘' in history_text, history_text
    assert seeded['note'] in history_text, history_text
    assert 'FL-' not in history_text, history_text
    assert page.locator('.sensory-history .sensory-record-visual svg').count() >= 1

    assert not errors, errors
    print(json.dumps({
        'entry_labels': visible_entry_labels,
        'compact_brew_history': compact_text,
        'compact_brew_history_height': compact_box['height'],
        'direct_modes': modes,
        'raw_sensory_encryption': seeded['raw']['sensory'].get('encryption'),
        'raw_identity_encryption': seeded['raw']['settings'].get('privateIdentity', {}).get('encryption'),
        'history_has_full_note': seeded['note'] in history_text,
        'history_has_radar': page.locator('.sensory-history .sensory-record-visual svg').count() >= 1,
    }, ensure_ascii=False))
    browser.close()
