// DRAFT — pending legal review. The factual parts describe how Howdy works
// today (src/lib/howdy/**) and the prices on the landing page's pricing
// section. Every legal judgement or policy choice is a visible [PLACEHOLDER].
import type { Metadata } from "next";

import {
  EmailLink,
  HOWDY_EMAIL,
  Item,
  LegalPage,
  List,
  PageLink,
  Placeholder,
  Section,
} from "../privacy/_components/legal";

export const metadata: Metadata = {
  title: "Howdy: Terms of Service (Draft)",
  description:
    "The terms for hiring creative freelancers through Howdy, or joining Howdy's freelancer roster. Draft pending legal review.",
  // Draft: keep it out of search results until it's reviewed and published.
  robots: { index: false, follow: false },
};

const TOC = [
  { id: "who-we-are", title: "Who we are" },
  { id: "what-howdy-does", title: "What Howdy does" },
  { id: "howdys-role", title: "Howdy’s role" },
  { id: "eligibility", title: "Who can use Howdy" },
  { id: "companies", title: "For companies hiring" },
  { id: "fees", title: "Fees" },
  { id: "freelancers", title: "For freelancers" },
  { id: "fair-use", title: "Using Howdy fairly" },
  { id: "emails", title: "Emails from Howdy" },
  { id: "content", title: "Your content and ours" },
  { id: "liability", title: "Disclaimers and liability" },
  { id: "ending", title: "Suspension and ending" },
  { id: "law", title: "Governing law and disputes" },
  { id: "changes", title: "Changes to these terms" },
  { id: "contact", title: "Contact us" },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      toc={TOC}
      intro={
        <p>
          These terms cover your use of Howdy: our website, the Howdy chat,
          and working with Howdy over email, whether you’re hiring or you’re a
          freelancer. Please read them alongside our{" "}
          <PageLink href="/privacy">Privacy Policy</PageLink>.
        </p>
      }
    >
      <Section id="who-we-are" title="Who we are">
        <p>
          Howdy is operated by{" "}
          <Placeholder>Bridge Creatives legal entity name and UEN</Placeholder>,{" "}
          <Placeholder>registered address</Placeholder> (“we”, “us”). “Howdy”
          means our AI agent and the service it runs.
        </p>
        <p>
          <Placeholder>
            how these terms are accepted (e.g. by using the service, or a
            checkbox on the hire form and freelancer application); the forms
            don’t show or link to the terms today
          </Placeholder>
        </p>
      </Section>

      <Section id="what-howdy-does" title="What Howdy does">
        <List ordered>
          <Item>
            You tell Howdy what you need, by email or in the chat on our
            website.
          </Item>
          <Item>
            Howdy asks follow-up questions until it has a clear brief. If you
            started in the chat, it emails the brief to you.
          </Item>
          <Item>
            Howdy picks freelancers from our roster who fit, and asks them,
            without naming you, whether they’re available.
          </Item>
          <Item>
            You get a shortlist, usually of up to three people. If we haven’t
            been able to confirm someone’s availability yet, the shortlist says
            so. We aim to send it within 24 hours.{" "}
            <Placeholder>
              whether response times are a commitment or an estimate
            </Placeholder>
          </Item>
          <Item>
            You reply with the people you’d like to meet, and Howdy introduces
            you by email.
          </Item>
          <Item>
            A few days later, Howdy checks in with both sides. If the call
            didn’t go well, it can line up new people.
          </Item>
        </List>
        <p>
          Howdy is an AI. It writes most messages, shortlists, and
          introductions, and it can make mistakes, so check anything important.
          A person on our team can read any conversation and step in. When
          they reply by hand, Howdy stops replying automatically in that
          conversation.
        </p>
      </Section>

      <Section id="howdys-role" title="Howdy’s role">
        <p>
          Howdy introduces companies and freelancers. As our site says, you
          agree the scope, rate, and payment directly with each other, and
          freelancers invoice the company directly.
        </p>
        <p>
          <Placeholder>
            legal relationship between Howdy, companies, and freelancers (e.g.
            independent contractors, no employment or agency, and who is
            responsible for the work, the contract, and payment between them)
          </Placeholder>
        </p>
      </Section>

      <Section id="eligibility" title="Who can use Howdy">
        <p>
          <Placeholder>
            eligibility (e.g. minimum age, business use only, authority to act
            for your company)
          </Placeholder>
        </p>
      </Section>

      <Section id="companies" title="For companies hiring">
        <List>
          <Item label="Your brief">
            Give Howdy an accurate brief. Freelancers see an anonymized version
            of it, paraphrased by AI, before they say yes, so keep anything
            confidential out of it.
          </Item>
          <Item label="Shortlists">
            A shortlist is a set of suggestions. A freelancer who said yes to
            Howdy’s check-in can still turn the work down, and you decide who
            to hire.
          </Item>
          <Item label="New matches">
            If a call doesn’t go well, Howdy can line up people you haven’t
            seen yet.{" "}
            <Placeholder>whether replacement matches are free or charged</Placeholder>
          </Item>
        </List>
        <p>
          <Placeholder>
            what we do and don’t promise about match quality, availability, and
            outcomes
          </Placeholder>
        </p>
      </Section>

      <Section id="fees" title="Fees">
        <p>The pricing section of our website lists:</p>
        <List>
          <Item label="$50 per match">
            A flat fee for every vetted creative we introduce you to.
          </Item>
          <Item label="10% service fee">
            <Placeholder>
              what the 10% service fee is calculated on, who pays it, and when
              it applies
            </Placeholder>
          </Item>
        </List>
        <p>
          Freelancers don’t pay Howdy. As our freelancer page says, they keep
          100% of what they earn, and Howdy makes its money on the company
          side.
        </p>
        <List>
          <Item>
            <Placeholder>
              billing and payment: when fees are due, how you’re invoiced,
              currency, payment terms, and taxes
            </Placeholder>
          </Item>
          <Item>
            <Placeholder>refund policy</Placeholder>
          </Item>
          <Item>
            <Placeholder>
              whether fees apply if you later hire the same freelancer again, or
              outside Howdy
            </Placeholder>
          </Item>
          <Item>
            <Placeholder>
              the homepage FAQ currently says there are no fees, a free trial,
              a monthly subscription, and free replacement matches; reconcile
              it with the pricing above before publishing
            </Placeholder>
          </Item>
        </List>
      </Section>

      <Section id="freelancers" title="For freelancers">
        <List>
          <Item label="Joining">
            The roster is invite-only. A person reviews every application, and
            we can’t accept everyone.
          </Item>
          <Item label="Briefs">
            Each brief Howdy sends you is an offer, not an obligation. Reply yes
            or no. If we don’t hear back in time, Howdy may offer it to someone
            else.
          </Item>
          <Item label="Saying yes">
            A yes means you’re available and interested. It isn’t a booking:
            the company chooses from its shortlist, and Howdy introduces you if
            they pick you.
          </Item>
          <Item label="What companies see">
            On a shortlist, the company sees your name, role, hourly rate,
            timezone, and a short note about you based on your profile. At the
            introduction, you each see the other’s name and email address.
          </Item>
        </List>
        <p>
          <Placeholder>
            freelancer obligations (e.g. accurate profile and rates, portfolio
            is your own work, keeping brief details confidential)
          </Placeholder>
        </p>
      </Section>

      <Section id="fair-use" title="Using Howdy fairly">
        <p>
          To keep Howdy working for everyone, we limit how many chat messages,
          form submissions, and emails we handle from one person or address in
          a given time, and we cap how much AI work Howdy does each day. If you
          hit a limit, Howdy may stop replying for a while.
        </p>
        <p>
          <Placeholder>
            prohibited uses (e.g. spam, scraping, misrepresentation,
            harassment) and what happens if someone breaks them
          </Placeholder>
        </p>
      </Section>

      <Section id="emails" title="Emails from Howdy">
        <p>
          Using Howdy means getting emails from it: replies to your messages,
          one reminder if you sign up but haven’t sent a brief, shortlists,
          invitations, introductions, and check-ins after an introduction.
        </p>
        <p>
          To stop Howdy’s follow-up emails, reply STOP to any Howdy email.
        </p>
      </Section>

      <Section id="content" title="Your content and ours">
        <p>
          <Placeholder>
            ownership and licence of what you send us (briefs, messages,
            portfolios), and of the work created between companies and
            freelancers
          </Placeholder>
        </p>
        <p>
          <Placeholder>ownership of Howdy’s site, brand, and content</Placeholder>
        </p>
      </Section>

      <Section id="liability" title="Disclaimers and liability">
        <p>
          <Placeholder>warranty disclaimers</Placeholder>
        </p>
        <p>
          <Placeholder>limitation of liability</Placeholder>
        </p>
        <p>
          <Placeholder>indemnity</Placeholder>
        </p>
      </Section>

      <Section id="ending" title="Suspension and ending">
        <p>
          <Placeholder>
            when we can suspend or end someone’s access, and how you can stop
            using Howdy
          </Placeholder>
        </p>
      </Section>

      <Section id="law" title="Governing law and disputes">
        <p>
          <Placeholder>governing law — likely Singapore</Placeholder>
        </p>
        <p>
          <Placeholder>
            dispute resolution: courts or arbitration, and where
          </Placeholder>
        </p>
      </Section>

      <Section id="changes" title="Changes to these terms">
        <p>
          <Placeholder>how we’ll tell people about changes to these terms</Placeholder>
        </p>
      </Section>

      <Section id="contact" title="Contact us">
        <p>
          Questions about these terms: <EmailLink address={HOWDY_EMAIL} />.
          This is Howdy’s own inbox, so an AI may answer first, and our team is
          alerted.
        </p>
        <p>
          <Placeholder>legal notices contact and address</Placeholder>
        </p>
      </Section>
    </LegalPage>
  );
}
