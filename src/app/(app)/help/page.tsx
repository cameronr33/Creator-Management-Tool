import { requireAgencyPage } from "@/lib/page-guards";
import Link from "next/link";
import type { Metadata } from "next";
import { LayoutDashboard, Kanban, Users, Settings, ArrowRight } from "lucide-react";
import { PageHeader, Card, CardHeader, StagePill, Badge } from "@/components/ui";
import { stagesByGroup, AUTO_TRIGGER_LABELS, stageLabel, STAGES, ACTIVE_STAGES, TERMINAL_STAGES } from "@/lib/stages";
import { AUTO_STAGE_RULES, type AutoStageTrigger } from "@/lib/auto-stage";
import { EMAIL_STAGE_RULES } from "@/lib/email-status";
import type { CmStage } from "@/lib/db/schema";

/** What each requirement in EMAIL_STAGE_RULES means, in plain English (decideEmailMove checks it). */
const EMAIL_REQUIRES: Record<string, string> = {
  nothing: "",
  address: " — and there's an address on file, or one they wrote",
  receipt: " — it's marked delivered too",
  post_link: " — and they sent the link to the post",
};
import { DEFAULT_THRESHOLDS } from "@/lib/outreach";

export const metadata: Metadata = { title: "How it works" };

/**
 * The onboarding page. Everything here is generated from the same tables
 * the app runs on (STAGES, AUTO_STAGE_RULES, EMAIL_STAGE_RULES,
 * DEFAULT_THRESHOLDS), so the explanation can't drift from the behaviour.
 */
export default async function HelpPage() {
  await requireAgencyPage();
  const triggers = Object.keys(AUTO_STAGE_RULES) as AutoStageTrigger[];
  const autoTargets = new Map<string, AutoStageTrigger[]>();
  for (const t of triggers) {
    const to = AUTO_STAGE_RULES[t].to;
    autoTargets.set(to, [...(autoTargets.get(to) ?? []), t]);
  }

  return (
    <>
      <PageHeader
        title="How Creator Manager works"
        help="Everything a new teammate needs on day one: the daily loop, what each stage means, what moves by itself, and where things live."
      />
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <Card id="a-to-z" className="p-5">
          <CardHeader
            title="From A to Z"
            description="Every creator goes down this list. Each step says what you do there; most steps move on by themselves once you've done it."
          />
          <ol className="mt-4 space-y-3">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">0</span>
              <div className="text-sm">
                <div className="font-medium text-text">Add creators</div>
                <p className="text-text-muted">
                  <Link href="/import" className="underline hover:text-accent">Import a CSV</Link> with a Name column and a Campaign column (campaigns are created for you), or{" "}
                  <Link href="/creators/new" className="underline hover:text-accent">add one</Link> by pasting their profile link. They start in {stageLabel("shortlisted")}.
                </p>
              </div>
            </li>
            {ACTIVE_STAGES.map((s, i) => (
              <li key={s.value} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                <div className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StagePill stage={s.value} />
                    <span className="text-text-muted">{s.hint}</span>
                  </div>
                  <p className="mt-0.5 text-text">{s.action}</p>
                </div>
              </li>
            ))}
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-text-muted">×</span>
              <div className="text-sm text-text-muted">
                At any point a deal can close: {TERMINAL_STAGES.map((s) => s.label).join(", ")}. A person always closes it — the app never does.
              </div>
            </li>
          </ol>
        </Card>

        <Card id="daily-loop" className="p-5">
          <CardHeader
            title="The daily loop"
            description="Four screens, in the order a day goes. Each one answers a single question."
          />
          <ol className="mt-4 space-y-3">
            <Step
              n={1}
              icon={<LayoutDashboard size={16} />}
              href="/"
              title="Today — what needs you?"
              body="Who wrote back, who is due a follow-up, who still needs a first message, whose address you need, and what is ready to ship. Every row shows the latest message, a stage menu, and the button for the next step, so most days start and end here."
            />
            <Step
              n={2}
              icon={<Kanban size={16} />}
              href="/pipeline"
              title="Pipeline — where every deal stands"
              body="One column per stage. Each card shows the campaign, the latest message and whose turn it is. Change the stage from the menu on the card, or drag it. Closing a deal asks who ended it and why, so the reason is never lost."
            />
            <Step
              n={3}
              icon={<Users size={16} />}
              href="/creators"
              title="Creators — the list you manage"
              body="Everyone you're tracking, with photos. Tick creators to move them to a stage or another campaign, fetch their photos and followers, or delete them. Open one for their conversation, deal, shipping and videos."
            />
            <Step
              n={4}
              icon={<Settings size={16} />}
              href="/settings"
              title="Settings — one-time setup"
              body="Connect the Gmail mailbox, set follow-up timing, and manage campaigns."
            />
          </ol>
        </Card>

        <Card id="stages" className="p-5">
          <CardHeader
            title="Stages — what is this creator waiting on?"
            description="A stage answers exactly one question: what is this creator waiting on? Tracking numbers, contract status and posted videos live on the record itself, not in the stage."
          />
          <div className="mt-4 space-y-5">
            {stagesByGroup().map((g) => (
              <div key={g.group}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-faint">{g.label}</div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {g.stages.map((s) => {
                    const auto = autoTargets.get(s.value) ?? [];
                    return (
                      <li key={s.value} className="grid grid-cols-1 gap-1 px-3 py-2.5 sm:grid-cols-[10rem_1fr] sm:gap-3">
                        <div>
                          <StagePill stage={s.value} />
                        </div>
                        <div className="text-sm text-text-muted">
                          {s.hint}
                          {auto.length > 0 && (
                            <div className="mt-1 text-xs text-text-faint">
                              Moves here by itself when {auto.map((t) => AUTO_TRIGGER_LABELS[t]).join(", or when ")}.
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <Card id="automatic" className="p-5">
          <CardHeader
            title="What moves by itself"
            description="You never have to babysit the stage menu after doing real work. These are the only automatic moves, and they never go backwards."
          />
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-text-faint">When you do something</h3>
          <ul className="mt-2 space-y-2">
            {triggers.map((t) => {
              const rule = AUTO_STAGE_RULES[t];
              return (
                <li key={t} className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <span className="flex flex-wrap items-center gap-1">
                    {rule.from.map((f) => (
                      <StagePill key={f} stage={f} />
                    ))}
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-text-faint" />
                  <StagePill stage={rule.to} />
                  <span>when {AUTO_TRIGGER_LABELS[t]}</span>
                </li>
              );
            })}
          </ul>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-text-faint">When their email says so</h3>
          <ul className="mt-2 space-y-2">
            {(Object.entries(EMAIL_STAGE_RULES) as [CmStage, { from: CmStage[]; requires: string }][]).map(([to, rule]) => (
              <li key={to} className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                <span className="flex flex-wrap items-center gap-1">
                  {rule.from.map((f) => (
                    <StagePill key={f} stage={f} />
                  ))}
                </span>
                <ArrowRight size={14} className="shrink-0 text-text-faint" />
                <StagePill stage={to} />
                <span>when one of the creator&apos;s own recent emails says so, quoted word for word{EMAIL_REQUIRES[rule.requires]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-text-faint">
            A move from email always shows the sentence it came from, on the creator&apos;s page, with Undo. It only uses
            their own message, never one from us or someone cc&apos;d, and never anything older than your last change to
            the stage. Nothing automatic ever closes a deal: if an email sounds like a no, it&apos;s flagged for you to
            close. A creator closed as {stageLabel("no_response")} is the one exception the other way — their own reply
            reopens them.
          </p>
        </Card>

        <Card id="follow-ups" className="p-5">
          <CardHeader
            title="Follow-ups"
            description="Today builds its follow-up list from each creator's messages, so nobody has to remember who's overdue."
          />
          <ul className="mt-3 space-y-1.5 text-sm text-text-muted">
            <li>
              Messaged, no reply for <strong>{DEFAULT_THRESHOLDS.followUp1AfterDays} days</strong> → follow-up 1 due.
            </li>
            <li>
              Still nothing <strong>{DEFAULT_THRESHOLDS.followUp2AfterDays} days</strong> after that → follow-up 2 due.
            </li>
            <li>
              <strong>{DEFAULT_THRESHOLDS.markNoResponseAfterDays} days</strong> after the second follow-up → review the
              conversation before closing as {stageLabel("no_response")}.
            </li>
          </ul>
          <p className="mt-3 text-xs text-text-faint">
            These are the defaults; each client can have its own timing under Settings → Follow-up timing. Rows imported
            from the old spreadsheet have no real dates, so they are flagged for a human check instead of being given an
            invented clock.
          </p>
        </Card>

        <Card id="numbers" className="p-5">
          <CardHeader title="Estimated vs verified numbers" />
          <div className="mt-3 space-y-2 text-sm text-text-muted">
            <p>
              Follower counts come from Instagram (<strong>Refresh from Instagram</strong> on a creator). View counts only
              arrive in an imported research file. Numbers marked{" "}
              <Badge tone="muted" title="Estimated — Instagram's own public count can be higher">
                estimated
              </Badge>{" "}
              came from a scraper that under-reports Instagram&apos;s public views, sometimes by a lot on viral posts.
            </p>
            <p>
              Nothing automatic ever overwrites a verified number with an estimate. Don&apos;t put an estimated number in a
              client report.
            </p>
          </div>
        </Card>

        <Card id="email" className="p-5">
          <CardHeader title="Email tracking" />
          <div className="mt-3 space-y-2 text-sm text-text-muted">
            <p>
              The app reads one shared mailbox (read-only) and searches it only for the email addresses saved on
              creators. Nothing else in the mailbox is read or stored. It never sends mail.
            </p>
            <p>
              <strong>The one rule:</strong> email creators from that mailbox or keep it on cc, and make sure their reply
              reaches it too. A conversation the mailbox never sees is invisible to the app.
            </p>
            <p>
              To start tracking someone&apos;s email, add their address on their creator page. Instagram DMs can&apos;t be
              read automatically, so log those with <strong>I messaged them</strong> and <strong>They replied</strong>.
            </p>
          </div>
        </Card>

        <Card id="words" className="p-5">
          <CardHeader title="Words we use" />
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[11rem_1fr]">
            <Term word="Owner">Who on the team looks after a deal. New ones start unassigned — click Take it, or assign them from a creator&apos;s page or in bulk on Creators. Mine shows yours plus unassigned ones.</Term>
            <Term word="Creator">A person or channel — their profile links, follower count and research. One record per client, reused across that client&apos;s campaigns.</Term>
            <Term word="Partnership">One creator working one campaign. That&apos;s what moves through the stages; a creator can have several.</Term>
            <Term word="Campaign">A client&apos;s effort that creators are recruited for, e.g. &ldquo;Evergreen creators&rdquo; or &ldquo;Suspension&rdquo;.</Term>
            <Term word="Content type (pillar)">What the creator mostly posts — overlanding, DIY, shop builds.</Term>
            <Term word="Posts / week">How often they post, from the research sample.</Term>
            <Term word="Brief">The document telling the creator what to make. &ldquo;Mark brief sent&rdquo; records the date.</Term>
            <Term word="Posted video">A live post we tracked — its link, date and views.</Term>
            <Term word="Exit reason">Why a deal closed, split by who ended it: we passed, they declined, or they stopped replying.</Term>
            <Term word="Timeline">Every message in or out, plus notes. Emails arrive on it by themselves.</Term>
          </dl>
        </Card>

        <p className="text-xs text-text-faint">
          There are {STAGES.length} stages. This page is generated from the app&apos;s own rules, so if it says something
          happens, it does.
        </p>
      </div>
    </>
  );
}

function Step({
  n,
  icon,
  href,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  href: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
        {n}
      </span>
      <div className="min-w-0">
        <Link href={href} className="inline-flex items-center gap-1.5 text-sm font-medium text-text hover:text-accent">
          <span className="text-text-faint">{icon}</span>
          {title}
        </Link>
        <p className="mt-0.5 text-sm leading-relaxed text-text-muted">{body}</p>
      </div>
    </li>
  );
}

function Term({ word, children }: { word: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-medium text-text">{word}</dt>
      <dd className="text-text-muted">{children}</dd>
    </>
  );
}
