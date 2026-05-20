import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Seed with real candidate pipeline data from Gem notifications
const CANDIDATES = [
  // From Aaron Rampersad (aaronrampersad@archive.com) - CS role
  { name: 'Tiago Munhoz', email: 't.munhoz01@gmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'INTERESTED', notes: 'Has enterprise LATAM CS background. Asking about SMB ARR, comp range, and remote.' },
  { name: 'Carlos Herrera', email: 'charliehe95@gmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'INTERESTED', notes: 'Interested but wants comp range before scheduling.' },
  { name: 'Maria Eugenia Cardenas', email: 'maria.eu.13@hotmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'INTERESTED', notes: 'Interested, asked for JD.' },
  { name: 'Lucas Reyes', email: 'lsreyesv@gmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'REPLIED', notes: 'Scheduled call for Thu May 21 10:30am.' },
  { name: 'Jorge Hoyos', email: 'jorgehoyos_91@hotmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'REPLIED', notes: 'Scheduled call for Thu May 21 4:30pm.' },
  { name: 'María Estupiñán', email: 'mariaestupinanmora@gmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'REPLIED', notes: 'Booked call for Thu May 21 11:30am.' },
  { name: 'Laura Constantino', email: 'laura.bconstantino@gmail.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'NOT_INTERESTED', notes: 'Gem: not interested.' },

  // From Paul Benigeri (pbenigeri@archive.com / benigeri.paul@archive.com) - Influencer Marketer
  { name: 'Douglas Williams', email: 'doug@pacvoicela.com', recruiterEmail: 'benigeri.paul@archive.com', status: 'INTERESTED', notes: 'Traveling, will follow up. Needs Calendly link.' },
  { name: 'Daniel Londoño Marulanda', email: 'dolondo320@hotmail.com', recruiterEmail: 'pbenigeri@archive.com', status: 'INTERESTED', notes: 'Wants more info: responsibilities, tasks, salary.' },
  { name: 'Luisa Hernández Rodríguez', email: 'lu-093@hotmail.com', recruiterEmail: 'pbenigeri@archive.com', status: 'INTERESTED', notes: 'Asking if role requires specific English level.' },
  { name: 'Laura Del Gordo', email: 'ldelgordo22@gmail.com', recruiterEmail: 'emaenza@archive.com', status: 'REPLIED', notes: 'Interested, Calendly sent.' },
  { name: 'Laura Lopez Montealegre', email: 'lauraf.lopezm@outlook.com', recruiterEmail: 'aaronrampersad@archive.com', status: 'NOT_INTERESTED', notes: 'Gem: not interested.' },
  { name: 'Laura Alaix', email: 'laura.hernandez@edenmed.com', recruiterEmail: 'emaenza@archive.com', status: 'NOT_INTERESTED', notes: 'Gem: not interested.' },

  // From Ethan Maenza (emaenza@archive.com) - Influencer Marketer (FDE) / Revenue
  { name: 'Robert Cortes', email: 'cast_robert.1@outlook.com', recruiterEmail: 'emaenza@archive.com', status: 'INTERESTED', notes: 'Replied from work email, wants outreach to personal (cast_robert.1@outlook.com). Available Friday.' },
  { name: 'Eduardo Penaloza', email: 'edpenaloza.97@gmail.com', recruiterEmail: 'emaenza@archive.com', status: 'REPLIED', notes: 'Replied, Calendly sent.' },
];

// Draft records for candidates still needing replies
const PENDING_DRAFTS = [
  {
    candidateName: 'Tiago Munhoz',
    candidateEmail: 't.munhoz01@gmail.com',
    classification: 'INTERESTED',
    confidence: 0.92,
    subject: 'Re: Hi Tiago',
    body: `Hi Tiago,\n\nThanks so much for your thoughtful note — really appreciate you being upfront about your background. Your LATAM enterprise CS experience sounds impressive.\n\nTo answer your questions:\n\n1. The SMB book has accounts typically in the $10K–$100K ARR range, so it's a different motion than high-touch enterprise. The opportunity is to own and scale the segment from the ground up.\n2. The role is fully remote.\n3. I'd love to share the full comp details on a call to make sure we're aligned.\n\nWould you be open to a quick 30-minute call? Here's my Calendly: https://calendly.com/sofia-archive/30min\n\nLooking forward to it!\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Carlos Herrera',
    candidateEmail: 'charliehe95@gmail.com',
    classification: 'INTERESTED',
    confidence: 0.88,
    subject: 'Re: Hi Carlos',
    body: `Hi Carlos,\n\nThanks for your interest — and for being direct about what you need to assess fit. I really appreciate that.\n\nRather than go back and forth over email, I'd love to cover comp in full on a quick call. The range is competitive and it's easier to walk through the complete package in context of the role.\n\nWould you be up for a 30-minute chat? Here's my Calendly: https://calendly.com/sofia-archive/30min\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Maria Eugenia Cardenas',
    candidateEmail: 'maria.eu.13@hotmail.com',
    classification: 'INTERESTED',
    confidence: 0.95,
    subject: 'Re: Hi María Eugenia',
    body: `Hi María Eugenia,\n\nSo glad you're interested! Here's a quick overview of the role:\n\nCustomer Success Manager at Archive:\n- Own and grow a book of SMB/mid-market client accounts\n- Lead onboarding, quarterly business reviews, and expansion conversations\n- Work closely with product and engineering — your client insights directly shape the platform\n- Archive is an AI-powered influencer marketing platform, growing fast\n\nThe role is fully remote. I'd love to share the full JD and walk you through compensation on a call.\n\nHere's my Calendly: https://calendly.com/sofia-archive/30min\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Douglas Williams',
    candidateEmail: 'doug@pacvoicela.com',
    classification: 'INTERESTED',
    confidence: 0.80,
    subject: 'Re: Customer Success Manager @ Archive',
    body: `Hi Douglas,\n\nWelcome back — hope the work travel was worthwhile! Paul passed along that you'd like to learn more, so I'm reaching out to help coordinate.\n\nI'd love to set up a quick 30-minute call to tell you more about what we're building at Archive. Here's my Calendly: https://calendly.com/sofia-archive/30min\n\nLooking forward to connecting!\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Daniel Londoño Marulanda',
    candidateEmail: 'dolondo320@hotmail.com',
    classification: 'INTERESTED',
    confidence: 0.85,
    subject: 'Re: Hi Daniel',
    body: `Hi Daniel,\n\nThanks for your interest — happy to share more!\n\nA quick overview of the role:\n- Archive is an AI-powered influencer marketing platform with strong growth momentum\n- As a Customer Success Manager, you'd own a book of accounts, leading onboarding, QBRs, retention, and expansion\n- You'd work closely with product and engineering to shape how the platform evolves\n- The role is fully remote\n\nAs for compensation, I'd love to cover that on a call so we can make sure it's the right fit on both sides.\n\nWould you be up for a quick 30-minute call? Here's my Calendly: https://calendly.com/sofia-archive/30min\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Luisa Hernández Rodríguez',
    candidateEmail: 'lu-093@hotmail.com',
    classification: 'INTERESTED',
    confidence: 0.87,
    subject: 'Re: Hi Luisa',
    body: `Hi Luisa,\n\nThank you for looking into Archive — so glad it caught your eye!\n\nTo answer your question: yes, the role does require strong English. It's a fully English-speaking position since we work primarily with clients in the US. Solid written and verbal English communication is essential.\n\nIf that works for you, I'd love to set up a quick 30-minute call to tell you more. Here's my Calendly: https://calendly.com/sofia-archive/30min\n\nLooking forward to connecting!\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
  {
    candidateName: 'Robert Cortes',
    candidateEmail: 'cast_robert.1@outlook.com',
    classification: 'INTERESTED',
    confidence: 0.82,
    subject: 'Re: Hi Robert — following up from Archive',
    body: `Hi Robert,\n\nThanks for getting back to us and for sharing your personal email — reaching out here as requested!\n\nI'm Sofia from the Archive recruiting team. Ethan mentioned you'd have availability on Friday — that works great! Feel free to grab a time on my Calendly: https://calendly.com/sofia-archive/30min\n\nLooking forward to telling you more about the role!\n\nBest,\nSofia Delgado\nRecruitment, Archive`,
  },
];

async function main() {
  console.log('Seeding database...');

  // Collect unique recruiter emails
  const recruiterEmails = [...new Set(CANDIDATES.map((c) => c.recruiterEmail))];

  // Create placeholder Mailbox records for each recruiter
  const mailboxMap: Record<string, string> = {};
  for (const email of recruiterEmails) {
    const mailbox = await prisma.mailbox.upsert({
      where: { emailAddress: email },
      update: {
        provider: 'GMAIL',
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        provider: 'GMAIL',
        emailAddress: email,
        displayName: email,
        credentials: JSON.stringify({ type: 'placeholder', note: 'Update with real credentials via /mailboxes/workspace/connect' }),
        isActive: true,
      },
    });
    mailboxMap[email] = mailbox.id;
    console.log(`  Mailbox: ${email} (${mailbox.id})`);
  }

  // Create Candidate + EmailThread records
  const candidateMap: Record<string, { candidateId: string; threadId: string }> = {};
  for (const c of CANDIDATES) {
    const mailboxId = mailboxMap[c.recruiterEmail];

    const candidate = await prisma.candidate.upsert({
      where: { email: c.email },
      update: {
        name: c.name,
        status: c.status,
        notes: c.notes,
        mailboxId,
        updatedAt: new Date(),
      },
      create: {
        name: c.name,
        email: c.email,
        status: c.status,
        notes: c.notes,
        mailboxId,
        source: 'GEM',
      },
    });

    const externalThreadId = `seed-thread-${candidate.id}`;
    const thread = await prisma.emailThread.upsert({
      where: {
        mailboxId_externalThreadId: {
          mailboxId,
          externalThreadId,
        },
      },
      update: {
        subject: `Re: ${c.name}`,
        lastMessageAt: new Date(),
      },
      create: {
        candidateId: candidate.id,
        mailboxId,
        externalThreadId,
        subject: `Re: ${c.name}`,
        lastMessageAt: new Date(),
      },
    });

    candidateMap[c.email] = { candidateId: candidate.id, threadId: thread.id };
    console.log(`  Candidate: ${c.name} <${c.email}> [${c.status}]`);
  }

  // Create EmailDraft records for pending replies
  for (const d of PENDING_DRAFTS) {
    const entry = candidateMap[d.candidateEmail];
    if (!entry) {
      console.warn(`  Warning: no candidate found for draft email ${d.candidateEmail}`);
      continue;
    }

    const existing = await prisma.emailDraft.findFirst({
      where: { threadId: entry.threadId, status: 'PENDING' },
    });

    if (!existing) {
      await prisma.emailDraft.create({
        data: {
          threadId: entry.threadId,
          subject: d.subject,
          bodyText: d.body,
          classification: d.classification,
          confidence: d.confidence,
          status: 'PENDING',
        },
      });
      console.log(`  Draft: ${d.subject} for ${d.candidateName}`);
    } else {
      console.log(`  Draft already exists for ${d.candidateName}, skipping`);
    }
  }

  console.log('Seeding complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { main };
