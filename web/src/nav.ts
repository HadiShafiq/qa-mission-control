import {

  Bot,
  Bug,
  ClipboardCheck,
  Cog,
  FileSearch,
  FileSpreadsheet,
  FolderKanban,
  GitBranch,
  Images,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Network,
  PackageOpen,
  PlayCircle,
  ScrollText,
  TestTubes,
} from 'lucide-react';

export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which the module is built. Items with phase > BUILT_PHASE show a planned page. */
  phase: number;
  summary: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Modules with phase <= BUILT_PHASE are implemented; later ones show a planned page. */
export const BUILT_PHASE = 2;

// Groups follow the testing lifecycle so the sidebar reads as the workflow.
export const NAV: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard, phase: 1, summary: 'Live metrics across all projects.' },
      { path: '/projects', label: 'Projects & CRs', icon: FolderKanban, phase: 1, summary: 'Projects, change requests, environments and source documents.' },
    ],
  },
  {
    label: 'Design tests',
    items: [
      { path: '/cr-analysis', label: 'CR Analysis Studio', icon: FileSearch, phase: 2, summary: 'Parse uploaded CR documents and extract testable requirements with source references, then review, edit and approve them.' },
      { path: '/scenarios', label: 'Test Scenario Studio', icon: ListChecks, phase: 3, summary: 'Generate traceable scenarios from approved requirements, check coverage and duplicates, and export a professional Excel workbook.' },
      { path: '/test-cases', label: 'Test Case Studio', icon: ClipboardCheck, phase: 4, summary: 'Turn approved scenarios into step-by-step test cases you can edit one at a time.' },
      { path: '/sitcr', label: 'SITCR Manager', icon: FileSpreadsheet, phase: 4, summary: 'Analyse your real SITCR template, map its fields and generate SITCR workbooks that keep its formatting and formulas.' },
      { path: '/uat-pack', label: 'UAT Evidence Pack', icon: ScrollText, phase: 4, summary: 'Convert SITCR into your UAT Evidence Pack format. Screenshot insertion arrives in Phase 7.' },
    ],
  },
  {
    label: 'Run & evidence',
    items: [
      { path: '/automation', label: 'Automation Studio', icon: TestTubes, phase: 5, summary: 'Generate, edit, copy and download Playwright TypeScript scripts, then run them headed or headless.' },
      { path: '/execution', label: 'Test Execution', icon: PlayCircle, phase: 8, summary: 'Record manual and automated results. Retests add a new run and never overwrite history.' },
      { path: '/evidence', label: 'Evidence Manager', icon: Images, phase: 7, summary: 'Upload and match screenshots to scenarios. Uncertain matches are marked Review Required.' },
      { path: '/defects', label: 'Defect Management', icon: Bug, phase: 8, summary: 'Log, assign, retest and close defects linked to scenarios and test cases.' },
    ],
  },
  {
    label: 'Insight',
    items: [
      { path: '/rtm', label: 'RTM & Coverage', icon: Network, phase: 8, summary: 'Bidirectional traceability from CR to defect, with documented coverage formulas and Excel export.' },
      { path: '/workbench', label: 'AI Agent Workbench', icon: Bot, phase: 9, summary: 'Give agents instructions in plain language, with approval checkpoints and a full action history.' },
      { path: '/reports', label: 'Reports & Exports', icon: PackageOpen, phase: 8, summary: 'Download every generated artifact with its version number.' },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/templates', label: 'Templates', icon: GitBranch, phase: 4, summary: 'Upload, inspect, map and version your own Excel templates.' },
      { path: '/settings', label: 'Settings', icon: Cog, phase: 1, summary: 'Server configuration and AI connection status.' },
    ],
  },
];

export const ALL_NAV = NAV.flatMap((g) => g.items);
