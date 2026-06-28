/**
 * Developer AI Usage Survey — Google Forms generator
 *
 * Run createSurveyForm() once. It builds a brand-new Google Form
 * with all sections, questions, and answer types, then logs the
 * edit and live URLs.
 */

function createSurveyForm(anonymous) {
  // anonymous: pass true (default) for anonymous responses — no email/identity captured.
  // Pass false to collect respondents' Google account email with each response.
  if (anonymous === undefined) anonymous = true;

  var form = FormApp.create('Developer AI Usage Survey');
  form.setDescription(
    'Goal: measure adoption and proficiency (basic to expert) of AI tooling ' +
    'across the software development lifecycle. ~5 minutes.' +
    (anonymous ? '\n\nResponses are anonymous — no email or identity is collected.'
               : '\n\nNote: your Google account email will be recorded with your response.')
  );
  form.setProgressBar(true);
  form.setCollectEmail(!anonymous);

  // Reusable scale option sets
  var MAT = ['Never', 'Tried it', 'Occasionally', 'Regularly', 'Core to my workflow'];
  var AGR = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

  // ---------- Helpers ----------
  function section(title, desc) {
    var p = form.addPageBreakItem().setTitle(title);
    if (desc) p.setHelpText(desc);
  }
  function single(title, options, required) {
    form.addMultipleChoiceItem()
      .setTitle(title)
      .setChoiceValues(options)
      .setRequired(required !== false);
  }
  function multi(title, options, required) {
    form.addCheckboxItem()
      .setTitle(title)
      .setChoiceValues(options)
      .setRequired(required !== false);
  }
  function scale(title, options, required) {
    // Rendered as single-select so labels are explicit (cleaner than 1-5 linear scale)
    single(title, options, required);
  }
  function text(title, required) {
    form.addParagraphTextItem()
      .setTitle(title)
      .setRequired(required === true);
  }

  // ========== Section 0 — Profile & Segmentation ==========
  section('Profile & Segmentation',
    'Lets us compare results across roles, seniority, and teams.');

  // Optional email opt-in. The form does NOT collect identity automatically
  // (setCollectEmail is off). This lets each respondent choose to share, or stay anonymous.
  form.addCheckboxItem()
    .setTitle('Sharing your email is optional')
    .setHelpText('This survey is anonymous by default. Only check the box below if you ' +
                 'are willing to be identified; otherwise leave it unchecked and skip the next field.')
    .setChoiceValues(['I am willing to share my email with this survey'])
    .setRequired(false);

  form.addTextItem()
    .setTitle('Your email (only if you checked the box above)')
    .setHelpText('Leave blank to remain anonymous.')
    .setRequired(false);

  single('Q1. What is your primary role?',
    ['Backend', 'Frontend', 'Full-stack', 'Mobile', 'DevOps / Platform',
     'Data / ML', 'Engineering manager', 'Other']);

  single('Q2. Years of professional software development experience?',
    ['< 1', '1–3', '4–7', '8–12', '12+']);

  single('Q3. How long have you been using AI coding tools?',
    ['Not yet', '< 3 months', '3–12 months', '1–2 years', '2+ years']);

  single('What is your seniority',
    ['Mid level', 'Senior 1', 'Senior 2', 'Staff', 'Principal', 'Fellow']);

  // ========== Section 1 — Adoption & Baseline ==========
  section('Adoption & Baseline', 'Breadth and frequency of use.');

  single('Q4. For what share of your coding tasks do you use Claude Code (or similar AI coding agents)?',
    ['None', '< 25%', '25–50%', '50–75%', '75–100%']);

  scale('Q5. How often do you still write code entirely without AI assistance?', MAT);

  multi('Q6. Which AI tools do you use as part of your work?',
    ['Claude Code', 'Claude (chat)', 'Cursor', 'GitHub Copilot',
     'ChatGPT', 'Gemini', 'Other', 'None']);

  single('Q7. On a typical working day, how frequently do you interact with an AI tool?',
    ['Never', 'A few times', 'Hourly', 'Constantly throughout the day']);

  // ========== Section 2 — Core Coding Workflow ==========
  section('Core Coding Workflow', 'Depth of day-to-day technique.');

  scale('Q8. How deliberately do you craft prompts for coding tasks (context, constraints, examples)?', MAT);
  scale('Q9. Do you use plan mode (or a plan-then-execute approach) before generating code?', MAT);
  scale('Q10. Do you use to-do lists / task breakdowns to structure AI work on larger tasks?', MAT);

  single('Q11. Do you use the same model for every task, or choose per task?',
    ['Always the same model', 'Mostly one, occasionally switch',
     'Deliberately choose per task type']);

  multi('Q12. When you choose models per task, what drives the choice?',
    ['Speed', 'Cost', 'Reasoning depth', 'Context window',
     'Task type', "I don't choose per task"]);

  scale('Q13. How often do you iterate/refine within a session rather than accepting the first output?', MAT);

  // ========== Section 3 — Advanced Tooling & Extensibility ==========
  section('Advanced Tooling & Extensibility', 'Building vs. only consuming.');

  scale('Q14. Do you use Skills?', MAT);
  scale('Q15. Do you use MCP servers / connectors?', MAT);
  single('Q16. Have you built your own Skills?', ['Yes', 'No']);
  single('Q17. Have you built or configured your own MCP servers?', ['Yes', 'No']);
  scale('Q18. Have you built automations for your day-to-day work (scripts, agents, pipelines)?', MAT);
  scale('Q19. Do you have reusable, defined workflows (saved prompts, templates) for recurring tasks?', MAT);
  single('Q20. Do you share or standardize AI workflows/skills with your team?', ['Yes', 'No']);

  single('Q21. Does your team have codified, shared AI standards (golden rules, coding standards, CLAUDE.md / agent config files)?',
    ['None', 'Informal verbal norms', 'Some documented',
     'Codified and enforced (e.g. CLAUDE.md in repos)']);

  // ========== Section 4 — SDLC Integration ==========
  section('SDLC Integration', 'How far AI reaches across the lifecycle.');

  scale('Q22. Do you use AI tools for research / exploring solutions / understanding a codebase?', MAT);

  multi('Q23. Which AI tools do you use specifically for research?',
    ['Claude', 'ChatGPT', 'Gemini', 'Perplexity',
     'Search-augmented tools', 'Other', 'None']);

  scale('Q24. Do you use AI tools for design work (architecture, diagrams, UI/UX, mockups)?', MAT);

  multi('Q25. At which SDLC stages do you use AI?',
    ['Research / discovery', 'Design / architecture', 'Coding', 'Testing',
     'Code review', 'Documentation', 'Debugging', 'Deployment / ops']);

  single('Q26. Do you have a clear, defined methodology for incorporating AI into your SDLC?',
    ['No methodology', 'Informal personal habits',
     'Documented personal approach', 'Team-wide defined methodology']);

  // ========== Section 5 — Quality & Control ==========
  section('Quality & Control', 'Verification rigor and trust.');

  scale('Q27. How thoroughly do you inspect the code/artifacts AI produces before using them?', MAT);
  scale('Q28. Do you use tools to review AI-generated output (linters, tests, AI reviewers, static analysis)?', MAT);
  scale('Q29. Do you persist AI-generated designs, plans, decisions, and assumptions in the codebase (e.g. ADRs, design docs, inline rationale)?', MAT);

  single('Q30. How often does AI-generated code introduce bugs/issues you only catch later?',
    ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often']);

  scale('Q31. I feel in control of the outputs AI generates in my workflow.', AGR);

  // ========== Section 6 — Impact & Sentiment ==========
  section('Impact & Sentiment', 'Perceived value and adoption barriers.');

  scale('Q32. AI tooling is improving my development velocity.', AGR);
  scale('Q33. I actively keep track of AI trends and new tooling.', MAT);

  single('Q34. How do you feel about the pace of new AI tooling?',
    ['Energized', 'Neutral', 'Mild stress',
     'Significant stress / overwhelm', "FOMO — worried I'm falling behind"]);

  // ========== Section 7 — Open Feedback ==========
  section('Open Feedback', 'The "why" that multiple-choice misses.');

  text('Q35. What is your single biggest blocker to using AI more effectively, ' +
       'and what one workflow or capability has delivered the most value for you?', false);

  // ---------- Done ----------
  Logger.log('Edit URL: ' + form.getEditUrl());
  Logger.log('Live URL: ' + form.getPublishedUrl());
}
