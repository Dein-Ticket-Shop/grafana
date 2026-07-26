import fs from 'fs';
import path from 'path';

// Guards the Dein-Ticket-Shop fork patch (fix(locale): change to de). GrafanaApp.init()
// pulls in the entire app bootstrap chain (backend services, echo service, i18n, ...)
// so it isn't practical to unit test by invoking it directly. Instead this asserts the
// patched line is still present verbatim. If this starts failing after a rebase onto
// upstream, the locale patch was dropped or setLocale's call site moved - see CLAUDE.md.
describe('GrafanaApp locale (Dein-Ticket-Shop fork)', () => {
  it('hardcodes the locale to de instead of the user-configured regional format', () => {
    const source = fs.readFileSync(path.join(__dirname, 'app.ts'), 'utf8');
    expect(source).toMatch(/setLocale\(\s*'de'\s*\)/);
  });
});
