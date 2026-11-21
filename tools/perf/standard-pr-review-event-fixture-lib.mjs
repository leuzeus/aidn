import fs from 'node:fs';
import path from 'node:path';
import { shadowHash } from '../../src/core/workflow/shadow-json.mjs';

// Fixture identity only. The host still derives context and accepted business
// provenance itself; this port cannot supply a readContext or an observer.
export function createStandardReviewEventFixture(controlRoot) {
  const file = path.join(controlRoot, 'standard-pr-review-event.json');
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { event: null };
  return Object.freeze({
    readEvent: async () => read().event,
    async verifyEvent({ event }) {
      const state = read();
      return { outcome: state.authorized === true && shadowHash(state.event) === shadowHash(event) ? 'verified' : 'denied',
        current: state.current === true, authority_id: event.authority_id, event_sha256: shadowHash(event),
        subject_sha256: shadowHash(state.wrong_actor ? { ...event.actor, node_id: 'U_other' } : event.actor) };
    },
  });
}
