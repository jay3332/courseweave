// SOC department codes → names. Unknown codes fall back to the code itself.
const NAMES: Record<string, string> = {
  AEM: 'Arts & Entertainment Management',
  ARC: 'Architecture',
  ART: 'Art',
  BMD: 'Biomedical Engineering',
  BSC: 'Biological Sciences',
  BUS: 'Business (Tepper)',
  BXA: 'BXA Intercollege Programs',
  CB: 'Computational Biology',
  CEE: 'Civil & Environmental Engineering',
  CFA: 'CFA Interdisciplinary',
  CHE: 'Chemical Engineering',
  CIT: 'CIT Interdisciplinary',
  CMU: 'University-Wide Studies',
  CMY: 'Chemistry',
  CS: 'Computer Science',
  CST: 'Institute for Politics & Strategy',
  DES: 'Design',
  DRA: 'Drama',
  ECE: 'Electrical & Computer Engineering',
  ECO: 'Economics',
  ENG: 'English',
  EPP: 'Engineering & Public Policy',
  ETC: 'Entertainment Technology Center',
  H00: 'Dietrich College General Education',
  HC: 'Heinz College',
  HCI: 'Human-Computer Interaction',
  HIS: 'History',
  HSS: 'Dietrich College Interdisciplinary',
  IED: 'Study Abroad & Exchange',
  III: 'Integrated Innovation Institute',
  INI: 'Information Networking Institute',
  ISM: 'Information Systems Management',
  ISP: 'Information Systems',
  LCL: 'Languages, Cultures & Applied Linguistics',
  LTI: 'Language Technologies Institute',
  MCS: 'MCS Interdisciplinary',
  MED: 'Heinz Executive Education',
  MEG: 'Mechanical Engineering',
  MIS: 'Miscellaneous',
  MLG: 'Machine Learning',
  MSC: 'Mathematical Sciences',
  MSE: 'Materials Science & Engineering',
  MUS: 'Music',
  NSI: 'Neuroscience Institute',
  NVS: 'Naval Science',
  PE: 'Physical Education',
  PHI: 'Philosophy',
  PHY: 'Physics',
  PMP: 'Public Management',
  PPP: 'Public Policy & Management',
  PSY: 'Psychology',
  ROB: 'Robotics',
  S3D: 'Software & Societal Systems',
  SCS: 'SCS Interdisciplinary',
  SDS: 'Social & Decision Sciences',
  STA: 'Statistics & Data Science',
  STU: 'StuCo',
}

export function departmentName(code: string): string {
  return NAMES[code] ?? code
}

// Delivery modes, per the Schedule of Classes legend.
const MODES: Record<string, string> = {
  IPE: 'In person',
  IPO: 'In person only',
  IPR: 'In person + remote',
  IRR: 'In person (rotation) + remote',
  IPT: 'In person + technology',
  PER: 'In person (rotation)',
  REO: 'Remote',
}

export function isRemote(mode: string): boolean {
  return mode.startsWith('RE')
}

export function modeLabel(mode: string): string {
  return MODES[mode] ?? mode
}
