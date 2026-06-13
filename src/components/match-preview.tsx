import { EmailThread, type EmailMessage } from "@/components/email-thread";

const SUBJECT = "Hey Howdy help me find a brand designer for our rebrand";

const MESSAGES: EmailMessage[] = [
  {
    from: "Zhang Wei",
    email: "zhang@cognition.com",
    initial: "Z",
    color: "bg-amber-500",
    direction: "outgoing",
    avatarSrc: "/zhang-avatar.jpg",
    time: "Wed 9:14 AM",
    snippet:
      "Rebranding before launch. Full identity: logo, type, deck. 3-week sprint.",
    body: (
      <p>
        Hey Howdy, we&apos;re rebranding before our public launch and need a
        brand designer — logo, type system, and launch deck. Three-week
        sprint, motion chops a big plus.
      </p>
    ),
  },
  {
    from: "Howdy",
    email: "howdy@howdy.ai",
    initial: "H",
    color: "bg-black",
    direction: "incoming",
    avatarSrc: "/howdy-logo.png",
    avatarBlend: true,
    time: "Wed 9:18 AM",
    snippet: "Match: Aria Singh, 8 yrs brand identity, $50/hr, starts Monday.",
    body: (
      <p>
        Got your match. <strong>Aria Singh</strong>, 8 yrs brand identity,
        30+ launches. $50/hr. Starts Monday. Portfolio below.
      </p>
    ),
  },
];

export function MatchPreview() {
  return (
    <EmailThread subject={SUBJECT} messages={MESSAGES} currentStep={1} />
  );
}
