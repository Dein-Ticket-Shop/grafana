import { Branding } from './Branding';

// Guards the Dein-Ticket-Shop fork patch (feat: branding). If this starts failing
// after a rebase onto upstream, the branding patch was dropped or Branding's static
// fields were renamed upstream - see CLAUDE.md.
describe('Branding (Dein-Ticket-Shop fork)', () => {
  it('overrides the app title', () => {
    expect(Branding.AppTitle).toBe('Dein-Ticket.Shop Grafana');
  });

  it('overrides the login title', () => {
    expect(Branding.LoginTitle).toBe('Welcome to Dein-Ticket.Shop Grafana');
  });
});
