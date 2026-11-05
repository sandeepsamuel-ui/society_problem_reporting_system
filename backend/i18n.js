// Server messages in English and Telugu. The browser sends its language in the X-Lang header.
const MESSAGES = {
  citizenFields: {
    en: 'Name, a valid email and a password of at least 6 characters are required',
    te: 'పేరు, సరైన ఇమెయిల్ మరియు కనీసం 6 అక్షరాల పాస్‌వర్డ్ అవసరం',
  },
  emailExists: { en: 'An account with this email already exists', te: 'ఈ ఇమెయిల్‌తో ఇప్పటికే ఖాతా ఉంది' },
  registered: { en: 'Registration successful. Please log in.', te: 'నమోదు విజయవంతమైంది. దయచేసి లాగిన్ అవ్వండి.' },
  badLogin: { en: 'Invalid email or password', te: 'ఇమెయిల్ లేదా పాస్‌వర్డ్ తప్పు' },
  adminFields: {
    en: 'Name, department, a valid department email and a password of at least 6 characters are required',
    te: 'పేరు, విభాగం, సరైన విభాగం ఇమెయిల్ మరియు కనీసం 6 అక్షరాల పాస్‌వర్డ్ అవసరం',
  },
  deptEmailExists: { en: 'This department email is already registered', te: 'ఈ విభాగం ఇమెయిల్ ఇప్పటికే నమోదైంది' },
  adminRegistered: { en: 'Department admin registered. Please log in.', te: 'విభాగ అధికారి నమోదయ్యారు. దయచేసి లాగిన్ అవ్వండి.' },
  badAdminLogin: { en: 'Invalid department or password', te: 'విభాగం లేదా పాస్‌వర్డ్ తప్పు' },
  pleaseLogin: { en: 'Please log in', te: 'దయచేసి లాగిన్ అవ్వండి' },
  notAllowed: { en: 'Not allowed for this account type', te: 'ఈ ఖాతా రకానికి అనుమతి లేదు' },
  sessionExpired: { en: 'Session expired, please log in again', te: 'సెషన్ ముగిసింది, దయచేసి మళ్ళీ లాగిన్ అవ్వండి' },
  needPhoto: { en: 'Please capture a photo (JPG, PNG or WebP, max 5 MB)', te: 'దయచేసి ఫోటో తీయండి (JPG, PNG లేదా WebP, గరిష్ఠం 5 MB)' },
  analysisFailed: { en: 'AI analysis failed: {err}', te: 'AI విశ్లేషణ విఫలమైంది: {err}' },
  photoNotFound: { en: 'Photo not found, please capture it again', te: 'ఫోటో కనబడలేదు, దయచేసి మళ్ళీ తీయండి' },
  alreadySubmitted: { en: 'This photo was already submitted', te: 'ఈ ఫోటో ఇప్పటికే సమర్పించబడింది' },
  needGps: { en: 'GPS location is required. Please allow location access.', te: 'GPS స్థానం అవసరం. దయచేసి లొకేషన్ అనుమతి ఇవ్వండి.' },
  notCivic: {
    en: 'The AI could not find a civic problem in this photo. Please take a clearer photo of the issue.',
    te: 'ఈ ఫోటోలో పౌర సమస్య AIకి కనబడలేదు. దయచేసి సమస్య స్పష్టంగా కనిపించేలా ఫోటో తీయండి.',
  },
  submitFailed: { en: 'Could not submit the issue: {err}', te: 'ఫిర్యాదును సమర్పించలేకపోయాము: {err}' },
  submitted: { en: 'Issue submitted successfully!', te: 'ఫిర్యాదు విజయవంతంగా సమర్పించబడింది!' },
  issueNotFound: { en: 'Issue not found in your department', te: 'మీ విభాగంలో ఈ సమస్య కనబడలేదు' },
  badStatus: { en: 'Status must be Submitted, In Progress or Resolved', te: 'స్థితి సమర్పించబడింది, పనిలో ఉంది లేదా పరిష్కరించబడింది అయి ఉండాలి' },
  statusUpdated: { en: 'Status updated to {s}', te: 'స్థితి "{s}"గా మార్చబడింది' },
  alreadyResolved: { en: 'This issue is already resolved', te: 'ఈ సమస్య ఇప్పటికే పరిష్కరించబడింది' },
  repairVerified: {
    en: '✅ Repair verified by AI. The issue is marked as Resolved.',
    te: '✅ AI మరమ్మతును ధృవీకరించింది. సమస్య "పరిష్కరించబడింది"గా గుర్తించబడింది.',
  },
  repairRejected: {
    en: '❌ The AI could not verify the repair. The issue was NOT marked as done. Check the reasons and upload a new photo from the site.',
    te: '❌ AI మరమ్మతును ధృవీకరించలేకపోయింది. సమస్య పూర్తయినట్లు గుర్తించబడలేదు. కారణాలు చూసి, స్థలం నుండి కొత్త ఫోటో అప్‌లోడ్ చేయండి.',
  },
  verifyFailed: { en: 'Verification failed: {err}', te: 'ధృవీకరణ విఫలమైంది: {err}' },
};

function langOf(req) {
  return (req.headers['x-lang'] || req.body?.lang) === 'te' ? 'te' : 'en';
}

function msg(req, key, vars = {}) {
  const entry = MESSAGES[key];
  let s = entry ? entry[langOf(req)] || entry.en : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

module.exports = { msg, langOf };
