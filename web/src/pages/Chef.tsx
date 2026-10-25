import { useLoad } from '../state.tsx';
import { Chat, ChatAvatar, type ChatPersona } from './Mixologist.tsx';

export const GORDY: ChatPersona = {
  endpoint: 'chef/chat',
  name: 'Gordy Scavengé',
  avatar: '/avatars/gordy-scavenge.png',
  emoji: '👨‍🍳',
  intro: "Well hey there, sugar, come on in! I'm Gordy Scavengé. Pull up a stool and tell me what you're craving. Southern comfort food, a perfect steak, Virginia-style Mexican, homemade rolls and biscuits, sweet tea or lemonade, that's my home turf, but I'll help with anything from the kitchen. I can see what's in your pantry, too.",
  starters: [
    'What can I cook tonight with what I have?',
    "Hardee's-style buttermilk biscuits",
    'Texas Roadhouse rolls with honey cinnamon butter',
    'Virginia-style Mexican white sauce',
    'How do I cook the perfect steak?',
    'Real Southern sweet tea',
  ],
  placeholder: 'What are you craving, sugar?',
  thinking: 'Gordy is stirring the pot…',
};

/** The AI chef chat with Gordy Scavengé. */
export function Chef() {
  const [status] = useLoad<{ available: boolean }>('/api/mixologist/status');
  return (
    <div className="stack">
      <div className="topbar">
        <ChatAvatar p={GORDY} size={48} />
        <h1>Chef Gordy</h1>
      </div>
      {status && !status.available && (
        <div className="card stack">
          <strong>Gordy needs a Claude API key</strong>
          <span className="muted">Set <code>ANTHROPIC_API_KEY</code> on the server (the same key the Mixologist uses) and restart.</span>
        </div>
      )}
      <Chat disabled={!status?.available} persona={GORDY} />
    </div>
  );
}
