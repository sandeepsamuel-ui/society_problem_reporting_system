// Help chatbot: answers questions about how to use CivicPulse, in English and Telugu.
// 1. Built-in knowledge base with keyword matching (always works, no API key).
// 2. If GEMINI_API_KEY is set, Gemini answers free-form questions using the same knowledge.
// 3. Logged-in users also get answers about their own data ("status of my complaint").
const db = require('../../db/database');
const llm = require('./llm');

// keywords: English, Telugu script, and Telugu typed in English letters. Matching is by substring.
const KB = [
  {
    id: 'greeting',
    keywords: ['hello', 'hi ', 'hii', 'hey', 'namaste', 'namaskaram', 'good morning', 'good evening', 'నమస్కారం', 'నమస్తే', 'హాయ్', 'హలో'],
    en: "Hello! 👋 I'm the CivicPulse assistant. I can explain how the app works, how to report a complaint, how to track it, and more. What would you like to know?",
    te: 'నమస్కారం! 👋 నేను CivicPulse సహాయకుడిని. యాప్ ఎలా పనిచేస్తుంది, ఫిర్యాదు ఎలా చేయాలి, దాన్ని ఎలా ట్రాక్ చేయాలి వంటివి వివరిస్తాను. మీకు ఏమి తెలుసుకోవాలి?',
    next: ['about', 'report', 'track'],
  },
  {
    id: 'about',
    keywords: ['how does the app work', 'how does it work', 'how it works', 'how this app works', 'what is this app', 'what is civicpulse', 'about the app', 'about app', 'app work', 'use this app', 'use the app', 'what can i do', 'features',
      'ఎలా పనిచేస్తుంది', 'ఎలా పని చేస్తుంది', 'యాప్ గురించి', 'ఈ యాప్', 'ఏమి చేయవచ్చు', 'ela pani chestundi', 'app gurinchi', 'ee app'],
    en: 'CivicPulse connects citizens with municipal departments:\n1️⃣ You take a photo of a problem (pothole, garbage, water leak, streetlight…). GPS adds the location.\n2️⃣ AI identifies the problem, writes the title and description, and sends it to the right department.\n3️⃣ If others reported the same problem nearby, the reports are merged so there is no spam.\n4️⃣ AI gives a severity score from 1 to 10. More reports, or a hospital or fire station within 1 km, raise the priority.\n5️⃣ The department officer sees it on their dashboard and map, and updates the status. You can track it under "My reports".',
    te: 'CivicPulse పౌరులను మున్సిపల్ విభాగాలతో కలుపుతుంది:\n1️⃣ సమస్య (గుంత, చెత్త, నీటి లీకేజీ, వీధి దీపం…) ఫోటో తీయండి. GPS స్థానాన్ని జోడిస్తుంది.\n2️⃣ AI సమస్యను గుర్తించి, శీర్షిక & వివరణ రాసి, సరైన విభాగానికి పంపుతుంది.\n3️⃣ సమీపంలో ఇతరులు అదే సమస్యను నివేదించి ఉంటే, ఫిర్యాదులు ఒకటిగా కలుపబడతాయి.\n4️⃣ AI 1 నుండి 10 వరకు తీవ్రత స్కోరు ఇస్తుంది. ఎక్కువ ఫిర్యాదులు లేదా 1 కి.మీ. లోపు ఆసుపత్రి/అగ్నిమాపక కేంద్రం ఉంటే ప్రాధాన్యత పెరుగుతుంది.\n5️⃣ విభాగ అధికారి డాష్‌బోర్డ్‌లో చూసి స్థితిని మారుస్తారు. మీరు "నా ఫిర్యాదులు"లో ట్రాక్ చేయవచ్చు.',
    next: ['report', 'severity', 'duplicate'],
  },
  {
    id: 'register',
    keywords: ['register', 'sign up', 'signup', 'create account', 'new account', 'make account', 'account', 'రిజిస్టర్', 'నమోదు', 'ఖాతా', 'kotha account', 'account ela'],
    en: 'To create an account:\n• Open the home page and choose "Citizen".\n• Click "Register" below the login form.\n• Enter your full name, email and a password (at least 6 characters), then click "Create account".\n• Log in with that email and password.\nDepartment officers choose "Department Admin" → "Register" and select their department.',
    te: 'ఖాతా సృష్టించడానికి:\n• హోమ్ పేజీలో "పౌరుడు" ఎంచుకోండి.\n• లాగిన్ ఫారం క్రింద "నమోదు చేసుకోండి" నొక్కండి.\n• మీ పూర్తి పేరు, ఇమెయిల్ మరియు పాస్‌వర్డ్ (కనీసం 6 అక్షరాలు) నమోదు చేసి "ఖాతా సృష్టించండి" నొక్కండి.\n• అదే ఇమెయిల్, పాస్‌వర్డ్‌తో లాగిన్ అవ్వండి.\nవిభాగ అధికారులు "విభాగ అధికారి" → "నమోదు చేసుకోండి" ఎంచుకుని తమ విభాగాన్ని ఎంచుకోవాలి.',
    next: ['login', 'report'],
  },
  {
    id: 'login',
    keywords: ['login', 'log in', 'sign in', 'signin', 'password', 'forgot', 'cannot login', "can't login", 'లాగిన్', 'పాస్‌వర్డ్', 'పాస్వర్డ్', 'login avvatledu'],
    en: 'Citizens log in with their email and password. Department admins choose "Department Admin", select their department and enter the department password.\nIf login fails, check the email and password (password needs at least 6 characters). There is no "forgot password" option yet: please register again with another email or contact your municipal office.',
    te: 'పౌరులు తమ ఇమెయిల్, పాస్‌వర్డ్‌తో లాగిన్ అవుతారు. విభాగ అధికారులు "విభాగ అధికారి" ఎంచుకుని, విభాగాన్ని ఎంచుకుని పాస్‌వర్డ్ నమోదు చేయాలి.\nలాగిన్ కాకపోతే ఇమెయిల్ మరియు పాస్‌వర్డ్ సరిచూడండి. "పాస్‌వర్డ్ మర్చిపోయారా" సౌకర్యం ఇంకా లేదు: వేరే ఇమెయిల్‌తో మళ్ళీ నమోదు చేసుకోండి లేదా మున్సిపల్ కార్యాలయాన్ని సంప్రదించండి.',
    next: ['register', 'report'],
  },
  {
    id: 'report',
    weight: 0.7, // general topic: more specific answers win when they also match
    keywords: ['complaint', 'complain', 'report', 'raise', 'file an issue', 'submit', 'record', 'lodge', 'register a complaint', 'register complaint', 'how to report', 'how do i report', 'how can i report', 'new issue', 'problem report',
      'ఫిర్యాదు', 'ఫిర్యాదు నమోదు', 'ఫిర్యాదు ఎలా నమోదు', 'సమస్య నమోదు', 'సమస్యను నివేదించ', 'నివేదించ', 'complaint ela', 'complaint cheyali', 'report cheyali', 'firyadu', 'phiryadu', 'samasya'],
    en: 'To record a complaint:\n1. Log in as a citizen. Allow GPS and camera when the browser asks.\n2. On "Report an issue", point the camera at the problem and tap "Capture photo" (or "Upload photo").\n3. AI fills in the category, department, title and description. You can edit them.\n4. Optional: tap 🎤 and describe it in Telugu or English, then "Update report with voice note".\n5. Tap "Submit issue". You get a ticket number and can follow it under "My reports".',
    te: 'ఫిర్యాదు నమోదు చేయడానికి:\n1. పౌరుడిగా లాగిన్ అవ్వండి. బ్రౌజర్ అడిగినప్పుడు GPS & కెమెరాకు అనుమతి ఇవ్వండి.\n2. "సమస్యను నివేదించండి"లో కెమెరాను సమస్య వైపు పెట్టి "ఫోటో తీయండి" (లేదా "ఫోటో అప్‌లోడ్") నొక్కండి.\n3. AI వర్గం, విభాగం, శీర్షిక, వివరణ నింపుతుంది. మీరు వాటిని మార్చవచ్చు.\n4. ఐచ్ఛికం: 🎤 నొక్కి తెలుగు లేదా ఇంగ్లీష్‌లో వివరించి, "వాయిస్ నోట్‌తో నివేదికను నవీకరించండి" నొక్కండి.\n5. "ఫిర్యాదు సమర్పించండి" నొక్కండి. మీకు టికెట్ నంబర్ వస్తుంది, "నా ఫిర్యాదులు"లో ట్రాక్ చేయవచ్చు.',
    next: ['voice', 'track', 'photo'],
  },
  {
    id: 'photo',
    keywords: ['photo', 'camera', 'picture', 'image', 'upload', 'capture', 'pic', 'ఫోటో', 'కెమెరా', 'చిత్రం', 'అప్‌లోడ్', 'photo teeyali'],
    en: 'Take a clear photo where the problem fills most of the picture, in daylight if possible. If the camera does not open, allow camera access in the browser address bar (🔒 icon) or use "Upload photo" to pick an image from your gallery. JPG, PNG and WebP up to 5 MB are accepted. If the AI says it cannot see a civic problem, retake the photo closer or add a voice note.',
    te: 'సమస్య ఫోటోలో ఎక్కువ భాగం కనిపించేలా, వీలైతే పగటి వెలుతురులో స్పష్టంగా తీయండి. కెమెరా తెరవకపోతే బ్రౌజర్ అడ్రస్ బార్‌లో (🔒 గుర్తు) కెమెరా అనుమతి ఇవ్వండి, లేదా "ఫోటో అప్‌లోడ్"తో గ్యాలరీ నుండి ఎంచుకోండి. 5 MB వరకు JPG, PNG, WebP అంగీకరించబడతాయి. AIకి సమస్య కనబడలేదంటే, దగ్గరగా మళ్ళీ తీయండి లేదా వాయిస్ నోట్ జోడించండి.',
    next: ['gps', 'voice'],
  },
  {
    id: 'voice',
    keywords: ['voice', 'using voice', 'by voice', 'with voice', 'speak', 'speech', 'mic', 'microphone', 'talk', 'audio', 'telugu voice', 'వాయిస్', 'మాట్లాడ', 'మైక్', 'గొంతు', 'matladi', 'voice tho'],
    en: 'Voice input helps if you prefer speaking to typing:\n• After taking the photo, choose Telugu or English next to the 🎤 button.\n• Tap 🎤, speak, then tap ⏹ to stop. Your words appear in the box.\n• Tap "Update report with voice note". The AI uses your words to pick the right department.\nVoice input works in Chrome or Edge and needs microphone permission.',
    te: 'టైప్ చేయడం కంటే మాట్లాడడం సులభమైతే వాయిస్ ఇన్‌పుట్ ఉపయోగించండి:\n• ఫోటో తీసిన తర్వాత 🎤 బటన్ పక్కన తెలుగు లేదా ఇంగ్లీష్ ఎంచుకోండి.\n• 🎤 నొక్కి మాట్లాడండి, ఆపడానికి ⏹ నొక్కండి. మీ మాటలు బాక్స్‌లో కనిపిస్తాయి.\n• "వాయిస్ నోట్‌తో నివేదికను నవీకరించండి" నొక్కండి. AI మీ మాటలతో సరైన విభాగాన్ని ఎంచుకుంటుంది.\nవాయిస్ Chrome లేదా Edgeలో పనిచేస్తుంది, మైక్రోఫోన్ అనుమతి అవసరం.',
    next: ['report', 'language'],
  },
  {
    id: 'gps',
    keywords: ['gps', 'location', 'permission', 'allow', 'address', 'where', 'లొకేషన్', 'స్థానం', 'అనుమతి', 'చిరునామా', 'location ela'],
    en: 'GPS records the exact place of the problem so the crew can find it. When you log in, the browser asks to allow location. Tap "Allow". If you blocked it, click the 🔒 icon in the address bar → Site settings → allow Location and Camera, then reload. You cannot submit a complaint without a location.',
    te: 'సిబ్బంది సమస్యను కనుగొనేందుకు GPS ఖచ్చితమైన స్థలాన్ని నమోదు చేస్తుంది. లాగిన్ అయినప్పుడు బ్రౌజర్ లొకేషన్ అనుమతి అడుగుతుంది, "Allow" నొక్కండి. నిరోధించి ఉంటే, అడ్రస్ బార్‌లో 🔒 → Site settings → Location మరియు Camera అనుమతించి పేజీని రీలోడ్ చేయండి. స్థానం లేకుండా ఫిర్యాదు సమర్పించలేరు.',
    next: ['photo', 'report'],
  },
  {
    id: 'track',
    keywords: ['track', 'status', 'status of', 'my complaint', 'my complaints', 'my report', 'my reports', 'history', 'progress', 'update on', 'where is my', 'ticket',
      'ట్రాక్', 'స్థితి', 'నా ఫిర్యాదు', 'నా ఫిర్యాదులు', 'ఏమైంది', 'na complaint', 'status enti', 'em aindi'],
    en: 'Open the "My reports" tab on your home page. Each complaint shows its ticket number, department, severity and status:\n• Submitted: received by the department\n• In Progress: a crew is working on it\n• Resolved: the problem is fixed\nTap "Refresh" to see the latest status.',
    te: 'హోమ్ పేజీలో "నా ఫిర్యాదులు" ట్యాబ్ తెరవండి. ప్రతి ఫిర్యాదుకు టికెట్ నంబర్, విభాగం, తీవ్రత, స్థితి కనిపిస్తాయి:\n• సమర్పించబడింది: విభాగానికి చేరింది\n• పనిలో ఉంది: సిబ్బంది పని చేస్తున్నారు\n• పరిష్కరించబడింది: సమస్య పరిష్కారమైంది\nతాజా స్థితి కోసం "రిఫ్రెష్" నొక్కండి.',
    next: ['time', 'severity'],
    dynamic: 'myStatus',
  },
  {
    id: 'severity',
    keywords: ['severity', 'priority', 'score', 'critical', 'rating', 'urgent', 'important', 'how serious', 'తీవ్రత', 'ప్రాధాన్యత', 'అత్యవసర', 'స్కోరు', 'rating enti'],
    en: 'Every complaint gets a severity score from 1 to 10:\n• The AI judges how dangerous the photo looks (e.g. live wires or sewage score high).\n• +1 to +3 when more citizens report the same problem (2, 5, 10 reports).\n• Up to +3 when a hospital, fire station, school, clinic or police station is within 1 km.\nScore 8–10 = Critical, 6–7 = High, 4–5 = Medium, 1–3 = Low. Departments handle Critical issues first.',
    te: 'ప్రతి ఫిర్యాదుకు 1 నుండి 10 వరకు తీవ్రత స్కోరు ఇవ్వబడుతుంది:\n• ఫోటో ఎంత ప్రమాదకరంగా ఉందో AI అంచనా వేస్తుంది (ఉదా. విద్యుత్ తీగలు, మురుగు ఎక్కువ స్కోరు).\n• ఎక్కువ మంది అదే సమస్యను నివేదిస్తే +1 నుండి +3 (2, 5, 10 ఫిర్యాదులు).\n• 1 కి.మీ. లోపు ఆసుపత్రి, అగ్నిమాపక కేంద్రం, పాఠశాల, క్లినిక్ లేదా పోలీస్ స్టేషన్ ఉంటే +3 వరకు.\n8–10 = అత్యవసరం, 6–7 = ఎక్కువ, 4–5 = మధ్యస్థం, 1–3 = తక్కువ. విభాగాలు అత్యవసర సమస్యలను ముందుగా పరిష్కరిస్తాయి.',
    next: ['duplicate', 'track'],
  },
  {
    id: 'duplicate',
    keywords: ['duplicate', 'same problem', 'same issue', 'already reported', 'someone else reported', 'merge', 'merged', 'spam', 'twice', 'నకిలీ', 'ఇప్పటికే', 'అదే సమస్య', 'కలుప', 'okate samasya'],
    en: 'If someone already reported the same problem nearby (within 250 m), the AI compares the photos. When they match, your report is merged into the existing ticket instead of creating a new one. Your complaint is not lost: it increases the citizen count, which raises the priority. You will see "Reported by N citizens" in My reports.',
    te: 'సమీపంలో (250 మీ. లోపు) ఎవరైనా అదే సమస్యను ఇప్పటికే నివేదించి ఉంటే, AI ఫోటోలను పోలుస్తుంది. రెండూ ఒకటే అయితే, కొత్త టికెట్‌కు బదులు మీ ఫిర్యాదు పాత టికెట్‌తో కలుపబడుతుంది. మీ ఫిర్యాదు వృథా కాదు: పౌరుల సంఖ్య పెరిగి ప్రాధాన్యత పెరుగుతుంది. "నా ఫిర్యాదులు"లో "N మంది పౌరులు నివేదించారు" అని కనిపిస్తుంది.',
    next: ['severity', 'track'],
  },
  {
    id: 'departments',
    weight: 0.7,
    keywords: ['department', 'which department', 'category', 'categories', 'who handles', 'types of problem', 'what problems', 'roads', 'garbage', 'water', 'electricity', 'drainage', 'streetlight', 'pothole',
      'విభాగం', 'విభాగాలు', 'ఏ సమస్యలు', 'రోడ్డు', 'చెత్త', 'నీరు', 'విద్యుత్', 'డ్రైనేజీ', 'vibhagam'],
    en: 'The AI sends each complaint to one of these departments:\n🛣️ Roads & Transport: potholes, damaged roads, traffic signals\n🗑️ Garbage & Sanitation: garbage dumps, overflowing bins, dead animals\n🚰 Water Supply: pipe leaks, no water, dirty water\n💡 Electricity & Streetlights: broken streetlights, fallen wires, transformers\n🌊 Drainage & Sewerage: blocked drains, sewage overflow, waterlogging\nAnything else goes to General Administration.',
    te: 'AI ప్రతి ఫిర్యాదును ఈ విభాగాలలో ఒకదానికి పంపుతుంది:\n🛣️ రోడ్లు & రవాణా: గుంతలు, దెబ్బతిన్న రోడ్లు, ట్రాఫిక్ సిగ్నల్స్\n🗑️ చెత్త & పారిశుద్ధ్యం: చెత్త కుప్పలు, నిండిన డబ్బాలు, చనిపోయిన జంతువులు\n🚰 నీటి సరఫరా: పైపు లీకేజీ, నీరు రాకపోవడం, మురికి నీరు\n💡 విద్యుత్ & వీధి దీపాలు: పనిచేయని దీపాలు, తెగిన తీగలు, ట్రాన్స్‌ఫార్మర్లు\n🌊 డ్రైనేజీ & మురుగునీరు: మూసుకుపోయిన కాలువలు, మురుగు పొంగడం, నీరు నిలవడం\nఇతర సమస్యలు సాధారణ పరిపాలనకు వెళ్తాయి.',
    next: ['report', 'ai'],
  },
  {
    id: 'ai',
    keywords: ['artificial intelligence', ' ai', 'ai ', 'ai ఎలా', 'ai ఎలా పనిచేస్తుంది', 'how does the ai', 'classify', 'automatic', 'automatically', 'how does ai', 'wrong department', 'wrong category', 'machine', 'ఏఐ', 'కృత్రిమ మేధ', 'తప్పు విభాగం'],
    en: 'CivicPulse uses AI in 4 ways: (1) it recognises the problem in your photo and picks the department, (2) it detects duplicate reports, (3) it raises priority for many reports or nearby hospitals and fire stations, (4) it gives a severity score from 1 to 10. If the AI picked the wrong category, add a voice note such as "water pipe leak" and tap "Update report with voice note". You can also edit the title and description before submitting.',
    te: 'CivicPulse AIని 4 విధాలుగా ఉపయోగిస్తుంది: (1) ఫోటోలో సమస్యను గుర్తించి విభాగాన్ని ఎంచుకుంటుంది, (2) నకిలీ ఫిర్యాదులను గుర్తిస్తుంది, (3) ఎక్కువ ఫిర్యాదులు లేదా సమీపంలో ఆసుపత్రులు ఉంటే ప్రాధాన్యత పెంచుతుంది, (4) 1–10 తీవ్రత స్కోరు ఇస్తుంది. AI తప్పు వర్గం ఎంచుకుంటే, "నీటి పైపు లీక్" వంటి వాయిస్ నోట్ జోడించి "వాయిస్ నోట్‌తో నివేదికను నవీకరించండి" నొక్కండి. సమర్పించే ముందు శీర్షిక, వివరణ కూడా మార్చవచ్చు.',
    next: ['departments', 'severity'],
  },
  {
    id: 'time',
    keywords: ['how long', 'when will', 'time', 'days', 'fixed', 'resolve', 'delay', 'not fixed', 'still not', 'ఎప్పుడు', 'ఎంత సమయం', 'రోజులు', 'ఆలస్యం', 'eppudu'],
    en: 'Resolution time depends on the department and the severity. Critical issues (score 8–10) are shown first on the department dashboard. You can see the status change from Submitted → In Progress → Resolved under "My reports". If the problem is not fixed for a long time, report it again: more reports raise its priority.',
    te: 'పరిష్కార సమయం విభాగం మరియు తీవ్రతపై ఆధారపడుతుంది. అత్యవసర సమస్యలు (స్కోరు 8–10) విభాగ డాష్‌బోర్డ్‌లో ముందుగా కనిపిస్తాయి. "నా ఫిర్యాదులు"లో స్థితి సమర్పించబడింది → పనిలో ఉంది → పరిష్కరించబడింది అని మారడం చూడవచ్చు. చాలా కాలం పరిష్కారం కాకపోతే మళ్ళీ నివేదించండి: ఎక్కువ ఫిర్యాదులు ప్రాధాన్యత పెంచుతాయి.',
    next: ['track', 'severity'],
  },
  {
    id: 'repair',
    keywords: ['marked as done', 'mark as done', 'marks it as done', 'marked done', 'verify the repair', 'verify', 'repair', ' done', 'completion photo', 'after photo', 'verify repair', 'verified', 'verification', 'proof', 'how do i know it is fixed', 'how do you know', 'resolved', 'fixed photo', 'before and after',
      'పూర్తయింది', 'పూర్తయినట్లు', 'ధృవీకర', 'మరమ్మతు', 'పూర్తి ఫోటో', 'ముందు తర్వాత', 'repair ayyinda'],
    en: 'A complaint is only marked done when the repair is proven:\n1. The department officer goes to the site and uploads a completion photo.\n2. The AI compares it with your original photo: is it the same place, and is the problem gone?\n3. The officer\'s GPS location must be within 150 m of the reported spot.\n4. Only if all checks pass is the issue marked Resolved. You will see the before and after photos in "My reports".\nIf the check fails, the issue stays open.',
    te: 'మరమ్మతు నిరూపితమైనప్పుడు మాత్రమే ఫిర్యాదు పూర్తయినట్లు గుర్తించబడుతుంది:\n1. విభాగ అధికారి స్థలానికి వెళ్లి పూర్తి ఫోటో అప్‌లోడ్ చేస్తారు.\n2. AI దాన్ని మీ అసలు ఫోటోతో పోలుస్తుంది: అదే స్థలమా, సమస్య పోయిందా?\n3. అధికారి GPS స్థానం నివేదించిన చోటు నుండి 150 మీ. లోపు ఉండాలి.\n4. అన్ని తనిఖీలు సరి అయితేనే సమస్య "పరిష్కరించబడింది"గా గుర్తించబడుతుంది. "నా ఫిర్యాదులు"లో ముందు, తర్వాత ఫోటోలు కనిపిస్తాయి.\nతనిఖీ విఫలమైతే సమస్య తెరిచే ఉంటుంది.',
    next: ['track', 'area'],
  },
  {
    id: 'area',
    keywords: ['red', 'orange', 'yellow', 'colour', 'color', 'is red', 'complaint red', 'why red', 'red zone', 'red area', 'red colour', 'is orange', 'is yellow', 'area priority', 'zone', 'nearby reports', 'people nearby', '1 km', '1km',
      'ఎరుపు', 'నారింజ', 'పసుపు', 'రంగు', 'రంగులు', 'ప్రాంత ప్రాధాన్యత', 'ఎరుపు ఎందుకు', 'ఫిర్యాదు ఎరుపు', 'ఎరుపు రంగు'],
    en: 'Each open complaint gets an area colour based on how many different citizens reported the same type of problem within 1 km:\n🔴 Red: 3 or more citizens. The department handles these first.\n🟠 Orange: 2 citizens\n🟡 Yellow: 1 citizen\nSo when neighbours also report problems nearby, the priority rises automatically. The colour is shown in "My reports" and on the department dashboard and map.',
    te: 'ప్రతి తెరిచి ఉన్న ఫిర్యాదుకు, 1 కి.మీ. లోపు అదే రకమైన సమస్యను ఎంత మంది పౌరులు నివేదించారో దాని ఆధారంగా ప్రాంత రంగు ఇవ్వబడుతుంది:\n🔴 ఎరుపు: 3 లేదా ఎక్కువ మంది. విభాగం వీటిని ముందుగా చూస్తుంది.\n🟠 నారింజ: 2 మంది\n🟡 పసుపు: 1 వ్యక్తి\nకాబట్టి పొరుగువారు కూడా సమీపంలో నివేదిస్తే ప్రాధాన్యత ఆటోమేటిక్‌గా పెరుగుతుంది. ఈ రంగు "నా ఫిర్యాదులు"లో, విభాగ డాష్‌బోర్డ్ మరియు మ్యాప్‌లో కనిపిస్తుంది.',
    next: ['severity', 'repair'],
  },
  {
    id: 'admin',
    keywords: ['admin', 'officer', 'dashboard', 'update status', 'change status', 'department login', 'crew', 'అధికారి', 'డాష్‌బోర్డ్', 'స్థితి మార్చ', 'adhikari'],
    en: "Department admins log in by choosing their department and password. The dashboard shows:\n• Counters: total, submitted, in progress, resolved, red-area issues, critical, duplicates merged, AI-verified repairs\n• Issues list with 🔴🟠🟡 area priority first (citizens reporting within 1 km), then severity. Click one to see the photo, map, reporters and the severity breakdown.\n• To close an issue, upload a completion photo from the site. The AI compares it with the citizen's photo and checks GPS, and only a verified repair is marked Resolved.\n• Heatmap: where problems occur most\n• AI log: every stored AI result\nAdmins only see their own department's issues.",
    te: 'విభాగ అధికారులు తమ విభాగం, పాస్‌వర్డ్‌తో లాగిన్ అవుతారు. డాష్‌బోర్డ్‌లో:\n• లెక్కలు: మొత్తం, సమర్పించబడినవి, పనిలో ఉన్నవి, పరిష్కరించబడినవి, ఎరుపు ప్రాంత సమస్యలు, అత్యవసరం, కలిపిన నకిలీలు, AI ధృవీకరించిన మరమ్మతులు\n• 🔴🟠🟡 ప్రాంత ప్రాధాన్యత (1 కి.మీ. లోపు నివేదించిన పౌరులు), తర్వాత తీవ్రత ప్రకారం సమస్యల జాబితా. ఒకదాన్ని నొక్కితే ఫోటో, మ్యాప్, నివేదించినవారు, తీవ్రత వివరాలు కనిపిస్తాయి.\n• సమస్యను మూసివేయడానికి స్థలం నుండి పూర్తి ఫోటో అప్‌లోడ్ చేయండి. AI దాన్ని పౌరుడి ఫోటోతో పోల్చి GPS తనిఖీ చేస్తుంది. ధృవీకరించిన మరమ్మతు మాత్రమే "పరిష్కరించబడింది"గా గుర్తించబడుతుంది.\n• హీట్‌మ్యాప్: సమస్యలు ఎక్కువగా ఎక్కడ ఉన్నాయి\n• AI లాగ్: భద్రపరచిన ప్రతి AI ఫలితం\nఅధికారులకు తమ విభాగ సమస్యలు మాత్రమే కనిపిస్తాయి.',
    next: ['heatmap', 'severity'],
    dynamic: 'adminSummary',
  },
  {
    id: 'heatmap',
    keywords: ['heatmap', 'heat map', 'map', 'hotspot', 'most problems', 'హీట్‌మ్యాప్', 'మ్యాప్', 'పటం'],
    en: 'The heatmap (admin dashboard → Heatmap tab) shows where problems occur most. Brighter areas mean more serious and more frequently reported issues. Coloured dots show each issue by priority (red = Critical, orange = High, yellow = Medium, green = Low, grey = Resolved). Click a dot to open the issue.',
    te: 'హీట్‌మ్యాప్ (అధికారి డాష్‌బోర్డ్ → హీట్‌మ్యాప్ ట్యాబ్) సమస్యలు ఎక్కువగా ఎక్కడ ఉన్నాయో చూపిస్తుంది. ప్రకాశవంతమైన ప్రాంతాలు అంటే తీవ్రమైన, ఎక్కువసార్లు నివేదించిన సమస్యలు. రంగు చుక్కలు ప్రాధాన్యతను చూపిస్తాయి (ఎరుపు = అత్యవసరం, నారింజ = ఎక్కువ, పసుపు = మధ్యస్థం, ఆకుపచ్చ = తక్కువ, బూడిద = పరిష్కరించబడింది). చుక్కను నొక్కితే సమస్య తెరుచుకుంటుంది.',
    next: ['admin'],
  },
  {
    id: 'language',
    keywords: ['language', 'telugu', 'english', 'change language', 'భాష ఎలా మార్చ', 'భాష మార్చ', 'భాష', 'తెలుగు', 'ఇంగ్లీష్', 'bhasha'],
    en: 'Use the "English | తెలుగు" switch at the top of every page to change the language. Your choice is remembered. Voice input also supports Telugu and English, and I answer in the language you choose.',
    te: 'భాష మార్చడానికి ప్రతి పేజీ పైభాగంలో ఉన్న "English | తెలుగు" స్విచ్ ఉపయోగించండి. మీ ఎంపిక గుర్తుంచుకోబడుతుంది. వాయిస్ ఇన్‌పుట్ కూడా తెలుగు, ఇంగ్లీష్‌కు మద్దతు ఇస్తుంది, నేను మీరు ఎంచుకున్న భాషలో సమాధానం ఇస్తాను.',
    next: ['voice', 'report'],
  },
  {
    id: 'privacy',
    keywords: ['privacy', 'private', 'data', 'safe', 'secure', 'who can see', 'personal', 'గోప్యత', 'డేటా', 'సురక్షితం', 'ఎవరు చూస్తారు'],
    en: "Your password is stored encrypted. Your complaint photo, description and location are shared only with the department that handles it. Department officers see your name and email so they can follow up. Other citizens cannot see your personal details.",
    te: 'మీ పాస్‌వర్డ్ ఎన్‌క్రిప్ట్ చేసి భద్రపరచబడుతుంది. మీ ఫిర్యాదు ఫోటో, వివరణ, స్థానం సంబంధిత విభాగంతో మాత్రమే పంచుకోబడతాయి. అవసరమైతే సంప్రదించడానికి విభాగ అధికారులకు మీ పేరు, ఇమెయిల్ కనిపిస్తాయి. ఇతర పౌరులకు మీ వ్యక్తిగత వివరాలు కనిపించవు.',
    next: ['about'],
  },
  {
    id: 'edit',
    keywords: ['edit', 'delete', 'cancel', 'remove', 'change my complaint', 'delete my complaint', 'delete complaint', 'cancel my complaint', 'withdraw', 'mistake', 'మార్చ', 'తొలగించ', 'రద్దు', 'తప్పు', 'delete cheyali'],
    en: 'Before submitting, you can edit the title and description, retake the photo or add a voice note. After submitting, a complaint cannot be edited or deleted, so the department keeps a reliable record. If you made a mistake, submit a new complaint with the correct details.',
    te: 'సమర్పించే ముందు శీర్షిక, వివరణ మార్చవచ్చు, ఫోటో మళ్ళీ తీయవచ్చు లేదా వాయిస్ నోట్ జోడించవచ్చు. సమర్పించిన తర్వాత ఫిర్యాదును మార్చడం లేదా తొలగించడం సాధ్యం కాదు, తద్వారా విభాగానికి నమ్మకమైన రికార్డు ఉంటుంది. పొరపాటు జరిగితే సరైన వివరాలతో కొత్త ఫిర్యాదు చేయండి.',
    next: ['report'],
  },
  {
    id: 'trouble',
    keywords: ['not working', 'error', 'failed', 'problem with app', 'stuck', 'loading', 'bug', 'cannot submit', "can't submit", 'పనిచేయడం లేదు', 'పని చేయడం లేదు', 'లోపం', 'రావడం లేదు', 'pani cheyyatledu'],
    en: 'Some quick fixes:\n• Use Chrome or Edge, and allow camera, location and microphone (🔒 icon in the address bar).\n• If "Submit" says GPS is required, wait a few seconds for the location, or turn on device location.\n• If the AI cannot see a problem, retake the photo closer or add a voice note.\n• If you are logged out suddenly, your session expired: log in again.',
    te: 'కొన్ని త్వరిత పరిష్కారాలు:\n• Chrome లేదా Edge ఉపయోగించండి, కెమెరా, లొకేషన్, మైక్రోఫోన్‌కు అనుమతి ఇవ్వండి (అడ్రస్ బార్‌లో 🔒).\n• GPS అవసరమని వస్తే, కొన్ని సెకన్లు వేచి ఉండండి లేదా ఫోన్ లొకేషన్ ఆన్ చేయండి.\n• AIకి సమస్య కనబడకపోతే దగ్గరగా ఫోటో తీయండి లేదా వాయిస్ నోట్ జోడించండి.\n• అకస్మాత్తుగా లాగౌట్ అయితే సెషన్ ముగిసింది: మళ్ళీ లాగిన్ అవ్వండి.',
    next: ['photo', 'gps'],
  },
  {
    id: 'emergency',
    keywords: ['emergency', 'fire', 'accident', 'ambulance', 'police', 'injured', 'dying', 'electrocut', 'అత్యవసర పరిస్థితి', 'అగ్ని', 'ప్రమాదం జరిగ', 'అంబులెన్స్', 'పోలీస్'],
    en: '🚨 If someone is in danger right now, call emergency services first: 112 (all emergencies), 108 (ambulance), 101 (fire), 100 (police). After that, report the civic problem here so the department can fix the cause.',
    te: '🚨 ఎవరైనా ఇప్పుడు ప్రమాదంలో ఉంటే, ముందుగా అత్యవసర సేవలకు కాల్ చేయండి: 112 (అన్ని అత్యవసరాలు), 108 (అంబులెన్స్), 101 (అగ్నిమాపక), 100 (పోలీస్). ఆ తర్వాత కారణాన్ని విభాగం సరిచేయడానికి ఇక్కడ సమస్యను నివేదించండి.',
    next: ['report'],
  },
  {
    id: 'thanks',
    keywords: ['thank', 'thanks', 'thx', 'bye', 'ok thanks', 'great', 'ధన్యవాదాలు', 'థాంక్స్', 'సరే', 'dhanyavadalu'],
    en: "You're welcome! 😊 Together we can keep our city clean and safe. Ask me anytime.",
    te: 'మీకు స్వాగతం! 😊 కలిసి మన నగరాన్ని శుభ్రంగా, సురక్షితంగా ఉంచుకుందాం. ఎప్పుడైనా అడగండి.',
    next: ['report', 'track'],
  },
];

const SUGGESTION_LABELS = {
  about: { en: 'How does the app work?', te: 'యాప్ ఎలా పనిచేస్తుంది?' },
  report: { en: 'How do I record a complaint?', te: 'ఫిర్యాదు ఎలా నమోదు చేయాలి?' },
  track: { en: 'How do I track my complaint?', te: 'నా ఫిర్యాదును ఎలా ట్రాక్ చేయాలి?' },
  voice: { en: 'How do I use voice input?', te: 'వాయిస్ ఇన్‌పుట్ ఎలా ఉపయోగించాలి?' },
  severity: { en: 'What is the severity score?', te: 'తీవ్రత స్కోరు అంటే ఏమిటి?' },
  duplicate: { en: 'What if someone already reported it?', te: 'ఇప్పటికే ఎవరైనా నివేదించి ఉంటే?' },
  departments: { en: 'Which departments are there?', te: 'ఏ విభాగాలు ఉన్నాయి?' },
  register: { en: 'How do I register?', te: 'ఎలా నమోదు చేసుకోవాలి?' },
  login: { en: 'I cannot log in', te: 'లాగిన్ కావడం లేదు' },
  photo: { en: 'Tips for taking the photo', te: 'ఫోటో తీయడానికి సూచనలు' },
  gps: { en: 'Why is GPS needed?', te: 'GPS ఎందుకు అవసరం?' },
  time: { en: 'When will it be fixed?', te: 'ఎప్పుడు పరిష్కరిస్తారు?' },
  admin: { en: 'How does the admin dashboard work?', te: 'అధికారి డాష్‌బోర్డ్ ఎలా పనిచేస్తుంది?' },
  heatmap: { en: 'What is the heatmap?', te: 'హీట్‌మ్యాప్ అంటే ఏమిటి?' },
  language: { en: 'How do I change the language?', te: 'భాష ఎలా మార్చాలి?' },
  ai: { en: 'How does the AI work?', te: 'AI ఎలా పనిచేస్తుంది?' },
  repair: { en: 'How is a complaint marked as done?', te: 'ఫిర్యాదు పూర్తయినట్లు ఎలా గుర్తిస్తారు?' },
  area: { en: 'What do the red, orange and yellow colours mean?', te: 'ఎరుపు, నారింజ, పసుపు రంగులు అంటే ఏమిటి?' },
};

const FALLBACK = {
  en: "Sorry, I didn't understand that. I can help with questions about this app, for example:",
  te: 'క్షమించండి, నాకు అర్థం కాలేదు. ఈ యాప్ గురించిన ప్రశ్నలకు సహాయం చేయగలను, ఉదాహరణకు:',
};

function suggestions(ids, lang) {
  return ids.filter((id) => SUGGESTION_LABELS[id]).map((id) => SUGGESTION_LABELS[id][lang]);
}

function defaultSuggestions(user) {
  if (user?.role === 'admin') return ['admin', 'repair', 'area', 'heatmap'];
  if (user?.role === 'citizen') return ['report', 'track', 'area', 'repair'];
  return ['about', 'register', 'report', 'language'];
}

function matchIntent(message) {
  const text = ' ' + message.toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let best = null;
  for (const intent of KB) {
    let score = 0;
    let hits = 0;
    for (const kw of intent.keywords) {
      if (text.includes(kw.toLowerCase())) { score += kw.trim().length; hits += 1; }
    }
    score = (score + hits * 3) * (intent.weight || 1);
    if (score > 0 && (!best || score > best.score)) best = { intent, score };
  }
  return best && best.score >= 5 ? best.intent : null;
}

// ---------- Answers that use the logged-in user's own data ----------
const STATUS_TE = { Submitted: 'సమర్పించబడింది', 'In Progress': 'పనిలో ఉంది', Resolved: 'పరిష్కరించబడింది' };

function myStatus(user, lang) {
  if (user?.role !== 'citizen') return null;
  const rows = db.prepare(`
    SELECT i.id, r.title, i.status, i.severity, i.report_count
    FROM reports r JOIN issues i ON i.id = r.issue_id
    WHERE r.citizen_id = ? ORDER BY r.id DESC LIMIT 3`).all(user.id);
  if (!rows.length) {
    return lang === 'te' ? 'మీరు ఇంకా ఏ ఫిర్యాదు చేయలేదు. "సమస్యను నివేదించండి" ట్యాబ్‌లో ఫోటో తీసి మొదలుపెట్టండి.' : 'You have not submitted any complaints yet. Start from the "Report an issue" tab by taking a photo.';
  }
  const lines = rows.map((r) => lang === 'te'
    ? `• #${r.id} ${r.title}: ${STATUS_TE[r.status]} (తీవ్రత ${r.severity}/10${r.report_count > 1 ? `, ${r.report_count} మంది నివేదించారు` : ''})`
    : `• #${r.id} ${r.title}: ${r.status} (severity ${r.severity}/10${r.report_count > 1 ? `, reported by ${r.report_count} citizens` : ''})`);
  return (lang === 'te' ? 'మీ తాజా ఫిర్యాదులు:\n' : 'Your latest complaints:\n') + lines.join('\n');
}

function adminSummary(user, lang) {
  if (user?.role !== 'admin') return null;
  const c = db.prepare(`SELECT
      SUM(status = 'Submitted') AS submitted, SUM(status = 'In Progress') AS progress,
      SUM(status = 'Resolved') AS resolved, SUM(priority = 'Critical' AND status != 'Resolved') AS critical
    FROM issues WHERE department = ?`).get(user.department);
  return lang === 'te'
    ? `మీ విభాగంలో ఇప్పుడు: ${c.submitted || 0} సమర్పించబడినవి, ${c.progress || 0} పనిలో ఉన్నవి, ${c.resolved || 0} పరిష్కరించబడినవి, ${c.critical || 0} అత్యవసర సమస్యలు తెరిచి ఉన్నాయి.`
    : `Right now your department has ${c.submitted || 0} submitted, ${c.progress || 0} in progress, ${c.resolved || 0} resolved, and ${c.critical || 0} open critical issues.`;
}
const DYNAMIC = { myStatus, adminSummary };

// ---------- Gemini (optional) ----------
function systemPrompt(user, lang) {
  const knowledge = KB.filter((k) => k.id !== 'greeting' && k.id !== 'thanks').map((k) => `[${k.id}]\n${k.en}`).join('\n\n');
  let context = 'The user is not logged in.';
  if (user?.role === 'citizen') context = `The user is a logged-in citizen named ${user.name}.\n${myStatus(user, 'en')}`;
  if (user?.role === 'admin') context = `The user is the admin of the ${user.departmentName} department. ${adminSummary(user, 'en')}`;
  return `You are the help assistant inside CivicPulse, a municipal civic-issue reporting web app used in Telangana and Andhra Pradesh, India.
Answer ONLY questions about using CivicPulse, reporting civic problems, or their status. For unrelated questions, politely say you can only help with the CivicPulse app.
Use only the facts below. Do not invent features, phone numbers or timelines. Keep answers short (under 120 words), friendly and practical, with numbered steps where useful.
Reply in ${lang === 'te' ? 'Telugu (తెలుగు script)' : 'English'}.

APP KNOWLEDGE:
${knowledge}

CURRENT USER:
${context}`;
}

async function answer({ message, lang = 'en', user = null, history = [] }) {
  lang = lang === 'te' ? 'te' : 'en';
  const text = String(message || '').trim().slice(0, 500);
  if (!text) {
    return { reply: KB[0][lang], suggestions: suggestions(defaultSuggestions(user), lang), source: 'faq' };
  }

  const intent = matchIntent(text);
  const extra = intent?.dynamic ? DYNAMIC[intent.dynamic](user, lang) : null;

  // Gemini handles anything the keyword matcher is unsure about (and keeps the conversation natural).
  if (llm.activeProvider() && (!intent || intent.id !== 'emergency')) {
    try {
      const turns = history.slice(-6).filter((m) => m && typeof m.text === 'string')
        .map((m) => ({ role: m.role === 'bot' ? 'bot' : 'user', text: m.text.slice(0, 1000) }));
      while (turns.length && turns[0].role === 'bot') turns.shift();
      const reply = await llm.chat({ system: systemPrompt(user, lang), history: [...turns, { role: 'user', text }] });
      if (reply) return { reply, suggestions: suggestions(intent?.next || defaultSuggestions(user), lang), source: 'gemini' };
    } catch (err) {
      console.warn('[chatbot] Gemini failed, using built-in answers:', err.message);
    }
  }

  if (intent) {
    const reply = extra ? `${extra}\n\n${intent[lang]}` : intent[lang];
    return { reply, suggestions: suggestions(intent.next, lang), source: 'faq', intent: intent.id };
  }
  return { reply: FALLBACK[lang], suggestions: suggestions(defaultSuggestions(user), lang), source: 'faq', intent: null };
}

function welcome(user, lang) {
  lang = lang === 'te' ? 'te' : 'en';
  return { reply: KB[0][lang], suggestions: suggestions(defaultSuggestions(user), lang) };
}

module.exports = { answer, welcome, matchIntent };
