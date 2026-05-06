import { EmailThread, type EmailMessage } from "@/components/email-thread";

const SUBJECT = "Hey Howdy help me find an iOS dev for our V1 app";

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
      "Need an iOS dev to ship our V1 app. Swift + SwiftUI, 6-week sprint.",
    body: (
      <p>
        Hey Howdy, need an iOS dev to ship our V1 app for launch. Swift +
        SwiftUI, 6-week sprint, animations heavy.
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
    snippet: "Match: Aria Singh, ex-Apple, $50/hr, starts Monday.",
    body: (
      <p>
        Got your match. <strong>Aria Singh</strong>, 8 yrs Swift, ex-Apple.
        $50/hr. Starts Monday. GitHub below.
      </p>
    ),
  },
];

export function MatchPreview() {
  return (
    <EmailThread subject={SUBJECT} messages={MESSAGES} currentStep={1} />
  );
}
