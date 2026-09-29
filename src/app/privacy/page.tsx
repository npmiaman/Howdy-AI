// DRAFT — pending legal review. The factual parts describe what the code does
// today (see the data flows in src/app/api/** and src/lib/howdy/**). Every
// legal judgement or policy choice is a visible [PLACEHOLDER] for the reviewer.
import type { Metadata } from "next";

import {
  EmailLink,
  HOWDY_EMAIL,
  Item,
  LegalPage,
  List,
  PageLink,
  Placeholder,
  Rows,
  Section,
  SubHeading,
} from "./_components/legal";

export const metadata: Metadata = {
  title: "Howdy: Privacy Policy (Draft)",
  description:
    "What information Howdy collects when you hire through Howdy or join its freelancer roster, how it's used, and who handles it. Draft pending legal review.",
  // Draft: keep it out of search results until it's reviewed and published.
  robots: { index: false, follow: false },
};

const TOC = [
  { id: "who-we-are", title: "Who we are" },
  { id: "what-we-collect", title: "What we collect" },
  { id: "how-we-use-it", title: "How we use it" },
  { id: "ai", title: "How Howdy uses AI" },
  { id: "sharing", title: "Who sees your information" },
  { id: "retention", title: "How long we keep it" },
  { id: "your-choices", title: "Your choices and rights" },
  { id: "security", title: "Security" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes to this policy" },
  { id: "contact", title: "Contact us" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      toc={TOC}
      intro={
        <p>
          Howdy is an AI talent scout run by Bridge Creatives. Companies tell
          Howdy what creative help they need, by email or in the chat on our
          website, and Howdy finds freelancers over email and introduces them.
          This policy explains what information that involves, what we do with
          it, and who else handles it.
        </p>
      }
    >
      <Section id="who-we-are" title="Who we are">
        <p>
          Howdy is operated by{" "}
          <Placeholder>Bridge Creatives legal entity name and UEN</Placeholder>,{" "}
          <Placeholder>registered address</Placeholder>. In this policy,
          “we”, “us” and “our” mean that company, and “Howdy” means our AI
          agent and the service it runs.
        </p>
        <p>
          This policy covers our website (including its forms and chat) and
          emails to and from Howdy at <EmailLink address={HOWDY_EMAIL} />. Our{" "}
          <PageLink href="/terms">Terms of Service</PageLink> cover how the
          service itself works.
        </p>
      </Section>

      <Section id="what-we-collect" title="What we collect">
        <SubHeading>If you’re hiring</SubHeading>
        <List>
          <Item label="The Hire Talent form">
            Your full name and email address, plus your company and position if
            you add them. When you submit it, we also record your IP address and
            your browser’s user agent (a short string describing your browser
            and device). If you submit the form again with the same email, we
            update your details instead of creating a new record.
          </Item>
          <Item label="The website chat">
            Every message you type, saved as soon as you send it, plus Howdy’s
            replies. Your browser keeps a random chat ID in local storage so
            your messages stay in one conversation; it’s cleared once your brief
            is emailed to you. When your brief is ready, Howdy asks for your
            name and email. We save those along with your IP address and user
            agent, email the brief to you, and copy the chat into that email
            conversation.
          </Item>
          <Item label="Emails with Howdy">
            The emails you send Howdy (your address, the name on your email,
            the subject, and the text of your message) and Howdy’s replies. The
            emails themselves are also held in Howdy’s inbox at our email
            provider, AgentMail. Howdy works from the text of your message; it
            doesn’t read attachments.
          </Item>
          <Item label="Your brief">
            From your messages, Howdy builds a structured brief: the role, a
            description of the project, deadline, budget, experience level,
            industry, tools, style references, must-haves, things to avoid,
            working style, and timezone preference.
          </Item>
          <Item label="Things Howdy remembers about you">
            Short notes tied to your email address, such as your name, company,
            position, and when you signed up or sent a brief. They carry over
            between conversations so Howdy doesn’t ask you the same things
            twice.
          </Item>
          <Item label="Your matches">
            Which freelancers were considered for your request, whether they
            said yes, who was on the shortlist we sent you, and who you picked.
          </Item>
          <Item label="After an introduction">
            About three days after we introduce you to someone, Howdy emails to
            ask how the call went. We save your replies, whether the call went
            well, and any feedback you share. If you plan a follow-up call,
            Howdy may check in once more a few days later.
          </Item>
          <Item label="Billing records">
            A record of each creative we introduce you to, the fee for it, and
            whether it’s been invoiced.{" "}
            <Placeholder>
              other billing and payment details collected (e.g. billing contact,
              company address, payment method) and the payment processor, if any
            </Placeholder>
          </Item>
        </List>

        <SubHeading>If you’re a freelancer</SubHeading>
        <List>
          <Item label="The Request an Invite form">
            Your name, email, what you do, and a link to your work, plus your
            hourly rate (USD), timezone, skills, and a short bio if you add
            them. If you send it again with the same email while it’s still
            being reviewed, we update your application.
          </Item>
          <Item label="Your roster profile">
            If a person on our team approves your application, we create your
            profile: name, email, role, skills, specialties, hourly rate,
            timezone, weekly availability, bio, and a summary of your
            portfolio.{" "}
            <Placeholder>
              how profiles are sourced for freelancers who didn’t apply (e.g.
              referrals, our existing network, public portfolios) and the basis
              for contacting them
            </Placeholder>
          </Item>
          <Item label="Invitations and replies">
            The briefs Howdy sends you, your replies (yes, no, or questions),
            and where each one stands.
          </Item>
          <Item label="After an introduction">
            Like clients, you may get a short check-in about how the call went.
            We save your replies and feedback.
          </Item>
        </List>

        <SubHeading>Everyone</SubHeading>
        <List>
          <Item label="Abuse and cost limits">
            To stop spam and runaway costs, we count requests in fixed time
            windows: per IP address for the forms and the chat, per chat ID,
            and per email sender. Each counter is stored under the IP address,
            chat ID, or email address it’s counting.
          </Item>
          <Item label="Email opt-outs">
            If you reply STOP to a Howdy email, we keep your email address on a
            do-not-email list so Howdy’s follow-up emails stop.
          </Item>
          <Item label="Technical logs">
            Our hosting provider keeps server logs. When something goes wrong,
            those logs can include parts of a message or form you sent, so we
            can recover it rather than lose it.
          </Item>
          <Item label="Cookies and trackers">
            The site stores the chat ID described above in your browser. Our
            site code doesn’t include analytics or advertising trackers.{" "}
            <Placeholder>
              confirm no analytics or tracking is enabled at the hosting level
              before publishing
            </Placeholder>
          </Item>
        </List>
      </Section>

      <Section id="how-we-use-it" title="How we use it">
        <p>We use the information above to:</p>
        <List>
          <Item>understand what you need and turn it into a brief;</Item>
          <Item>
            find freelancers who fit, by comparing your brief with roster
            profiles and ranking the best fits;
          </Item>
          <Item>
            check freelancers’ availability, send you a shortlist, and make
            introductions;
          </Item>
          <Item>
            check in after introductions, and line up new people if a call
            didn’t go well;
          </Item>
          <Item>remember context from one conversation to the next;</Item>
          <Item>
            send you one reminder if you sign up but haven’t told us what you
            need yet;
          </Item>
          <Item>review freelancer applications (a person reviews every one);</Item>
          <Item>bill for introductions;</Item>
          <Item>prevent abuse and keep our costs under control; and</Item>
          <Item>
            let our team see what’s happening and step in (see{" "}
            <a href="#sharing" className="underline underline-offset-4">
              Who sees your information
            </a>
            ).
          </Item>
        </List>
        <p>
          <Placeholder>
            legal basis for each use under applicable data protection law (e.g.
            consent, contract, legitimate interests), to be confirmed by counsel
          </Placeholder>
        </p>
      </Section>

      <Section id="ai" title="How Howdy uses AI">
        <p>
          Howdy is an AI agent, and it writes most of its own messages. To do
          that, we send information to Google’s Gemini API, including:
        </p>
        <List>
          <Item>
            your messages and conversation history, to write replies, ask
            follow-up questions, and build your brief;
          </Item>
          <Item>your brief and the notes Howdy remembers about you;</Item>
          <Item>
            freelancer profiles, to rank matches and write the short notes on
            why each person fits; and
          </Item>
          <Item>
            replies from clients and freelancers, to understand them (for
            example, whether a freelancer said yes, or whether a call went
            well).
          </Item>
        </List>
        <p>
          We also use Gemini to turn briefs and freelancer profiles into
          numbers (called embeddings), which is how Howdy compares them to find
          a fit.
        </p>
        <p>
          AI can get things wrong. A person on our team can read any
          conversation and step in.
        </p>
        <p>
          <Placeholder>
            whether Google may store or use data sent through the Gemini API,
            based on the API terms and plan we use
          </Placeholder>
        </p>
        <p>
          <Placeholder>
            automated decision-making disclosure, if required (Howdy’s ranking
            decides which freelancers are offered a brief)
          </Placeholder>
        </p>
      </Section>

      <Section id="sharing" title="Who sees your information">
        <SubHeading>Between clients and freelancers</SubHeading>
        <List>
          <Item label="Before a freelancer says yes">
            Howdy sends them an anonymized version of your brief: the kind of
            work, industry, timeline, budget, style references, tools, and
            working style. Howdy is instructed never to include your name, your
            company, or other details that identify you. Your project
            description is paraphrased by AI, so please keep anything
            confidential out of your brief.
          </Item>
          <Item label="On a shortlist">
            When we send a client a shortlist, it includes each freelancer’s
            name, role, hourly rate, and timezone, with a short note on why they
            fit, written from their profile (skills, specialties, bio, and
            portfolio).
          </Item>
          <Item label="At the introduction">
            When a client picks a freelancer who has said yes, Howdy sends one
            introduction email to both of them, so each sees the other’s name
            and email address.
          </Item>
        </List>

        <SubHeading>Our team</SubHeading>
        <p>
          People on our team get email alerts about new messages, applications,
          and anything that goes wrong. These alerts include excerpts of what
          was sent and the addresses on the email, including anyone CC’d. Team
          members can read full conversations and reply themselves. When one of
          them replies by hand, Howdy stops replying automatically in that
          conversation until it’s handed back.
        </p>
        <p>
          <Placeholder>
            which team roles have access, and the email provider(s) that receive
            internal alerts
          </Placeholder>
        </p>

        <SubHeading>Service providers</SubHeading>
        <p>These companies handle information for us to run Howdy:</p>
        <Rows
          rows={[
            {
              label: "Supabase",
              detail: "Our main database. It stores everything described above.",
            },
            {
              label: "Backup database",
              detail: (
                <>
                  A second, separate database that keeps a copy of
                  conversations, messages, and briefs in case the main one
                  fails. <Placeholder>backup database provider and location</Placeholder>
                </>
              ),
            },
            {
              label: "AgentMail",
              detail: "Sends and receives Howdy’s email and holds Howdy’s inbox.",
            },
            {
              label: "Google (Gemini API)",
              detail: "AI processing, as described in How Howdy uses AI.",
            },
            {
              label: "Vercel",
              detail:
                "Hosts our website and the code that runs Howdy, including its server logs.",
            },
          ]}
        />
        <p>
          We may also export copies of the database as backups.{" "}
          <Placeholder>
            where manual backups are stored, who can access them, and for how
            long
          </Placeholder>
        </p>
        <p>
          <Placeholder>
            where each provider stores data, and the safeguards for
            international transfers
          </Placeholder>
        </p>

        <SubHeading>Anyone else</SubHeading>
        <p>
          <Placeholder>
            statement on selling or sharing personal data for advertising
          </Placeholder>
        </p>
        <p>
          <Placeholder>
            disclosures required by law, and what happens to data if the
            business is sold or merged
          </Placeholder>
        </p>
      </Section>

      <Section id="retention" title="How long we keep it">
        <p>
          Howdy doesn’t delete anything automatically yet.{" "}
          <Placeholder>data retention period for each category below</Placeholder>
        </p>
        <Rows
          rows={[
            "Hire form and chat contact details (including IP address and user agent)",
            "Website chat transcripts",
            "Email conversations and briefs (our database, the backup database, and the AgentMail inbox)",
            "Notes Howdy remembers about you",
            "Match records and check-in feedback",
            "Billing records",
            "Freelancer applications, including ones we turn down",
            "Freelancer roster profiles",
            "Abuse and cost-limit counters",
            "Do-not-email list",
            "Server logs",
            "Database backups",
          ].map((label) => ({
            label,
            detail: <Placeholder>retention period</Placeholder>,
          }))}
        />
      </Section>

      <Section id="your-choices" title="Your choices and rights">
        <List>
          <Item label="Stop follow-up emails">
            Reply STOP to any Howdy email.
          </Item>
          <Item label="Say no to a brief">
            Freelancers can turn down any brief by replying no. There’s no
            penalty.
          </Item>
          <Item label="Update your application">
            Send the Request an Invite form again with the same email.
          </Item>
          <Item label="Reach a person">
            Our team is alerted to new messages and can take over any
            conversation from Howdy.
          </Item>
          <Item label="Reset the chat">
            Clearing your browser’s data for our site removes the chat ID.
          </Item>
          <Item label="See, correct, or delete your information">
            <Placeholder>
              rights available under applicable law (e.g. access, correction,
              deletion, withdrawing consent), how to make a request, identity
              verification, and response time
            </Placeholder>{" "}
            Email <Placeholder>privacy contact email</Placeholder>.
          </Item>
        </List>
        <p>
          <Placeholder>
            right to complain to a data protection authority, if applicable
          </Placeholder>
        </p>
      </Section>

      <Section id="security" title="Security">
        <p>
          <Placeholder>
            description of security measures, checked for accuracy before
            publishing
          </Placeholder>
        </p>
      </Section>

      <Section id="children" title="Children">
        <p>
          Howdy is built for businesses and working creatives.{" "}
          <Placeholder>minimum age and children’s data statement</Placeholder>
        </p>
      </Section>

      <Section id="changes" title="Changes to this policy">
        <p>
          <Placeholder>how we’ll tell people about changes to this policy</Placeholder>
        </p>
      </Section>

      <Section id="contact" title="Contact us">
        <p>
          Privacy questions and requests:{" "}
          <Placeholder>privacy contact email</Placeholder>
        </p>
        <p>
          General questions: <EmailLink address={HOWDY_EMAIL} />. This is
          Howdy’s own inbox, so an AI may answer first, and our team is alerted.
        </p>
        <p>
          <Placeholder>data protection officer contact, if required</Placeholder>{" "}
          <Placeholder>postal address</Placeholder>
        </p>
      </Section>
    </LegalPage>
  );
}
