// ── English → Hinglish (Hindi in Roman script) converter ──────────────────────
// Fully offline: no network calls, no API key, nothing ever leaves the device.
// This is a best-effort phrase + word substitution engine, not a real translator —
// it recognizes common storytelling phrases and swaps them for natural Hinglish,
// and falls back to leaving unrecognized words in English (normal in real Hinglish
// writing too). It won't invent descriptive embellishments the way a human or an
// AI translator would; that needs real language understanding, not pattern matching.

// Longer, fixed phrases — checked first, longest first, so "everyone praised his
// honesty" wins over the shorter "everyone praised" and "honesty" on their own.
const HINGLISH_FIXED_PHRASES = [
    ['once upon a time', 'ek baar ki baat hai'],
    ['a long long time ago', 'bahut purani baat hai'],
    ['a long time ago', 'bahut samay pehle'],
    ['many years ago', 'kai saal pehle'],
    ['many years later', 'kai saalon baad'],
    ['in a small village', 'ek chhote se gaon mein'],
    ['in a small town', 'ek chhote se shehar mein'],
    ['in a big city', 'ek bade shehar mein'],
    ['in a village', 'ek gaon mein'],
    ['in a city', 'ek shehar mein'],
    ['one fine day', 'ek achhe se din'],
    ['one day', 'ek din'],
    ['every single day', 'har roz'],
    ['every day', 'har din'],
    ['from that day onwards', 'us din se'],
    ['from that day', 'us din se'],
    ['after some time', 'kuchh samay baad'],
    ['after a while', 'thodi der baad'],
    ['after that', 'uske baad'],
    ['before that', 'usse pehle'],
    ['in the end', 'aakhir mein'],
    ['at last', 'aakhirkaar'],
    ['the end', 'kahani yahin samapt hoti hai'],
    ['moral of the story', 'kahani ki seekh'],
    ['the moral of this story is', 'is kahani ki seekh yeh hai ki'],
    ['everyone was happy', 'sabhi khush the'],
    ['everyone was very happy', 'sabhi bahut khush the'],
    ['everyone praised his honesty', 'sabhi logon ne uski imaandari ki tareef ki'],
    ['everyone praised her honesty', 'sabhi logon ne uski imaandari ki tareef ki'],
    ['everyone praised him', 'sabne uski tareef ki'],
    ['everyone praised her', 'sabne uski tareef ki'],
    ['everyone praised', 'sabhi logon ne tareef ki'],
    ['lived happily ever after', 'khushi khushi rehne lage'],
    ['without any hesitation', 'bina kisi hichkichahat ke'],
    ['without a second thought', 'bina kuchh soche'],
    ['without thinking twice', 'bina do baar soche'],
    ['without any greed', 'bina kisi lalach ke'],
    ['without any fear', 'bina kisi dar ke'],
    ['full of joy', 'khushi se bhara hua'],
    ['tears of joy', 'khushi ke aansu'],
    ['with a smile on his face', 'apne chehre par muskaan ke saath'],
    ['with a smile on her face', 'apne chehre par muskaan ke saath'],
    ['with tears in his eyes', 'aankhon mein aansu liye'],
    ['with tears in her eyes', 'aankhon mein aansu liye'],
    ['thanked him from the bottom of his heart', 'dil se uska shukriya ada kiya'],
    ['thanked her from the bottom of her heart', 'dil se uska shukriya ada kiya'],
    ['from the bottom of his heart', 'dil ki gehraiyon se'],
    ['from the bottom of her heart', 'dil ki gehraiyon se'],
    ['worked very hard', 'bahut mehnat ki'],
    ['tried his best', 'apni poori koshish ki'],
    ['tried her best', 'apni poori koshish ki'],
    ['did not give up', 'haar nahi maani'],
    ['never gave up', 'kabhi haar nahi maani'],
    ['took care of him', 'uska khyaal rakha'],
    ['took care of her', 'uska khyaal rakha'],
    ['took care of', 'khyaal rakha'],
    ['he decided to', 'usne faisla kiya ki wo'],
    ['she decided to', 'usne faisla kiya ki wo'],
    ['they decided to', 'unhone faisla kiya ki wo'],
    ['he realized that', 'use ehsaas hua ki'],
    ['she realized that', 'use ehsaas hua ki'],
    ['he understood that', 'wo samajh gaya ki'],
    ['she understood that', 'wo samajh gayi ki'],
    ['he was very happy', 'wo bahut khush tha'],
    ['she was very happy', 'wo bahut khush thi'],
    ['he was very sad', 'wo bahut udaas tha'],
    ['she was very sad', 'wo bahut udaas thi'],
    ['he started crying', 'wo rone laga'],
    ['she started crying', 'wo rone lagi'],
    ['everyone started laughing', 'sab hansne lage'],
    ['everyone clapped', 'sabne taaliyan bajayi'],
    ['found a wallet on the road', 'raaste mein ek wallet mila'],
    ['find its owner', 'uske asli malik ko dhoondhna'],
    ['found its owner', 'uske asli malik ko dhoond liya'],
    ['found the owner', 'malik ko dhoond liya'],
    ['gave the wallet to', 'wallet de diya'],
    ['on his way home', 'ghar jaate waqt'],
    ['on her way home', 'ghar jaate waqt'],
    ['on his way to school', 'school jaate waqt'],
    ['on her way to school', 'school jaate waqt'],
    ['went to the police station', 'police station gaya'],
    ['gave it back to', 'wapas kar diya'],
    ['gave it back', 'wapas kar diya'],
    ['thanked him a lot', 'uska bahut shukriya ada kiya'],
    ['thanked her a lot', 'uska bahut shukriya ada kiya'],
    ['thanked him', 'uska shukriya ada kiya'],
    ['thanked her', 'uska shukriya ada kiya'],
    ['a piece of advice', 'ek salaah'],
    ['once again', 'ek baar phir'],
    ['as usual', 'hamesha ki tarah'],
    ['all of a sudden', 'achanak se'],
    ['all of sudden', 'achanak se'],
    ['as soon as possible', 'jitni jaldi ho sake'],
    ['no matter what', 'kuchh bhi ho jaye'],
    ['because of this', 'isi wajah se'],
    ['for this reason', 'isi karan'],
    ['at the same time', 'usi samay'],
    ['for a long time', 'lambe samay tak'],
    ['for a while', 'thodi der ke liye'],
    ['little by little', 'dheere dheere'],
    ['step by step', 'kadam kadam'],
    ['not only', 'sirf itna hi nahi'],
    ['not far away', 'kuchh hi door'],
    ['not too far', 'zyada door nahi'],
];

// Regex templates with a capture group — for the handful of common sentence
// shapes worth handling more specifically than plain word-substitution.
const HINGLISH_TEMPLATES = [
    [/\ba boy named ([A-Za-z]+)/gi, (m, name) => `${name} naam ka ek ladka`],
    [/\ba girl named ([A-Za-z]+)/gi, (m, name) => `${name} naam ka ek ladki`],
    [/\ba man named ([A-Za-z]+)/gi, (m, name) => `${name} naam ka ek aadmi`],
    [/\ba woman named ([A-Za-z]+)/gi, (m, name) => `${name} naam ka ek aurat`],
    [/\bnamed ([A-Za-z]+)/gi, (m, name) => `${name} naam ka`],
    [/\bfound (?:a|an) ([a-z]+) on the road\b/gi, (m, noun) => `raaste mein ek ${_hinglishWord(noun)} mila`],
    [/\bfound (?:a|an) ([a-z]+)\b/gi, (m, noun) => `ek ${_hinglishWord(noun)} mila`],
    [/\bit was full of ([a-z]+)\b/gi, (m, noun) => `usmein bahut saara ${_hinglishWord(noun)} tha`],
    [/\bwas full of ([a-z]+)\b/gi, (m, noun) => `${_hinglishWord(noun)} se bhara hua tha`],
    [/\ba (?:mota|thick|big) and (?:sundar|beautiful) ([a-z]+)/gi, (m, noun) => `mota aur sundar ${_hinglishWord(noun)}`],
];

// Single-word fallback — applied to whatever's left after phrases/templates,
// one token at a time. Anything not listed here stays in English, same as
// real Hinglish writing does for names, brands, and less common words.
const HINGLISH_WORDS = {
    // pronouns
    i: 'main', you: 'tum', he: 'wo', she: 'wo', it: 'yeh', we: 'hum', they: 'wo log',
    me: 'mujhe', him: 'use', her: 'use', us: 'hume', them: 'unhe',
    my: 'mera', your: 'tumhara', his: 'uska', its: 'uska', our: 'hamara', their: 'unka', mine: 'mera',
    myself: 'khud', himself: 'khud', herself: 'khud', themselves: 'khud',
    // articles / function words
    the: '', a: 'ek', an: 'ek', and: 'aur', but: 'lekin', or: 'ya',
    because: 'kyunki', if: 'agar', when: 'jab', then: 'tab', so: 'isliye',
    that: 'ki', this: 'yeh', these: 'ye', those: 'wo', who: 'jo', which: 'jo',
    what: 'kya', where: 'kahan', why: 'kyun', how: 'kaise',
    very: 'bahut', also: 'bhi', only: 'sirf', always: 'hamesha', never: 'kabhi nahi',
    sometimes: 'kabhi kabhi', again: 'phir se', still: 'abhi bhi', already: 'pehle se',
    soon: 'jald hi', now: 'ab', here: 'yahan', there: 'wahan',
    with: 'ke saath', without: 'ke bina', for: 'ke liye', from: 'se', to: 'ko',
    in: 'mein', on: 'par', by: 'dwara', about: 'ke baare mein',
    before: 'pehle', after: 'baad mein', during: 'ke dauran', until: 'jab tak', since: 'jab se',
    yes: 'haan', no: 'nahi', not: 'nahi', all: 'sabhi', every: 'har', each: 'har ek',
    many: 'bahut saare', few: 'kuchh', some: 'kuchh', other: 'doosra', same: 'wahi',
    // common nouns
    boy: 'ladka', girl: 'ladki', man: 'aadmi', woman: 'aurat', child: 'bachcha',
    children: 'bachche', king: 'raja', queen: 'rani', prince: 'rajkumar', princess: 'rajkumari',
    father: 'pita', mother: 'maa', brother: 'bhai', sister: 'behen', son: 'beta',
    daughter: 'beti', friend: 'dost', teacher: 'shikshak', student: 'vidyarthi',
    doctor: 'doctor', farmer: 'kisan', merchant: 'vyapari', thief: 'chor', soldier: 'sipahi',
    village: 'gaon', city: 'shehar', forest: 'jungle', river: 'nadi', mountain: 'pahad',
    house: 'ghar', home: 'ghar', school: 'school', market: 'bazaar', temple: 'mandir',
    road: 'raasta', path: 'raasta', tree: 'ped', animal: 'janwar', dog: 'kutta', cat: 'billi',
    bird: 'chidiya', lion: 'sher', tiger: 'baagh', elephant: 'hathi', monkey: 'bandar',
    snake: 'saanp', fish: 'machli', cow: 'gaay', horse: 'ghoda',
    wallet: 'wallet', money: 'paise', gold: 'sona', food: 'khana', water: 'paani',
    fire: 'aag', sky: 'aasman', sun: 'suraj', moon: 'chand', star: 'tara', rain: 'baarish',
    wind: 'hawa', world: 'duniya', life: 'zindagi', death: 'maut',
    love: 'pyaar', happiness: 'khushi', sadness: 'udaasi', honesty: 'imaandari',
    courage: 'himmat', kindness: 'daya', wisdom: 'samajhdaari', truth: 'sach', lie: 'jhooth',
    dream: 'sapna', hope: 'ummeed', fear: 'dar', anger: 'gussa', patience: 'sabr',
    freedom: 'azaadi', justice: 'insaaf', peace: 'shanti', war: 'yudh',
    victory: 'jeet', defeat: 'haar', god: 'bhagwan', heaven: 'swarg',
    story: 'kahani', lesson: 'seekh', day: 'din', night: 'raat', morning: 'subah',
    evening: 'shaam', week: 'hafta', month: 'mahina', year: 'saal', time: 'samay',
    place: 'jagah', way: 'raasta', thing: 'cheez', person: 'insaan', people: 'log',
    everyone: 'sabhi', someone: 'koi', nobody: 'koi nahi', everything: 'sab kuchh',
    nothing: 'kuchh nahi', owner: 'malik', officer: 'afsar', police: 'police',
    // common adjectives
    honest: 'imaandaar', kind: 'nekdil', good: 'achha', bad: 'bura', big: 'bada',
    small: 'chhota', beautiful: 'sundar', ugly: 'badsurat', rich: 'ameer', poor: 'gareeb',
    happy: 'khush', sad: 'udaas', angry: 'naraz', brave: 'bahadur', scared: 'darpok',
    strong: 'takatwar', weak: 'kamzor', wise: 'samajhdaar', foolish: 'bewakoof',
    young: 'jawan', old: 'bura', new: 'naya', true: 'sach', false: 'jhooth',
    right: 'sahi', wrong: 'galat', easy: 'aasaan', difficult: 'mushkil',
    important: 'zaroori', dangerous: 'khatarnaak', safe: 'surakshit', hot: 'garam',
    cold: 'thanda', fast: 'tez', slow: 'dheema', hard: 'sakht', soft: 'naram',
    alone: 'akela', together: 'saath mein', first: 'pehla', last: 'aakhri',
    // common verbs (kept simple / gender-neutral past-tense, as casual Hinglish often does)
    found: 'mila', find: 'dhoondhna', gave: 'diya', give: 'dena', took: 'liya',
    take: 'lena', went: 'gaya', go: 'jaana', came: 'aaya', come: 'aana',
    said: 'kaha', say: 'kehna', told: 'bataya', tell: 'batana', thought: 'socha',
    think: 'sochna', knew: 'jaanta tha', know: 'jaanna', got: 'mila', get: 'milna',
    made: 'banaya', make: 'banana', decided: 'faisla kiya', decide: 'faisla karna',
    helped: 'madad ki', help: 'madad karna', thanked: 'shukriya kaha', thank: 'shukriya karna',
    praised: 'tareef ki', praise: 'tareef karna', saw: 'dekha', see: 'dekhna',
    heard: 'suna', hear: 'sunna', ran: 'bhaga', run: 'bhaagna', walked: 'chala',
    walk: 'chalna', smiled: 'muskuraya', smile: 'muskurana', cried: 'roya', cry: 'rona',
    laughed: 'hansa', laugh: 'hansna', lived: 'raha', live: 'rehna', worked: 'kaam kiya',
    work: 'kaam karna', played: 'khela', play: 'khelna', studied: 'padhai ki',
    study: 'padhna', learned: 'seekha', learn: 'seekhna', taught: 'sikhaya',
    teach: 'sikhana', returned: 'wapas kiya', return: 'wapas karna', left: 'chhod diya',
    arrived: 'pahuncha', arrive: 'pahunchna', waited: 'intezaar kiya', wait: 'intezaar karna',
    looked: 'dekha', look: 'dekhna', watched: 'dekha', watch: 'dekhna', met: 'mila',
    meet: 'milna', called: 'bulaya', call: 'bulana', wrote: 'likha', write: 'likhna',
    read: 'padha', sang: 'gaya', sing: 'gaana', danced: 'nacha', dance: 'naachna',
    won: 'jeeta', win: 'jeetna', lost: 'haara', lose: 'haarna', tried: 'koshish ki',
    try: 'koshish karna', hoped: 'ummeed ki', hope: 'ummeed karna', prayed: 'prarthna ki',
    pray: 'prarthna karna', forgave: 'maaf kiya', forgive: 'maaf karna',
    promised: 'wada kiya', promise: 'wada karna', believed: 'vishwaas kiya',
    believe: 'vishwaas karna', trusted: 'bharosa kiya', trust: 'bharosa karna',
    loved: 'pyaar kiya', hated: 'nafrat ki', hate: 'nafrat karna', feared: 'dara',
    worried: 'chinta ki', worry: 'chinta karna', remembered: 'yaad rakha',
    remember: 'yaad rakhna', forgot: 'bhool gaya', forget: 'bhoolna', realized: 'ehsaas hua',
    realize: 'ehsaas hona', chose: 'chuna', choose: 'chunna', agreed: 'maan gaya',
    agree: 'maanna', refused: 'inkaar kiya', refuse: 'inkaar karna', allowed: 'ijazat di',
    allow: 'ijazat dena', stopped: 'roka', stop: 'rokna', started: 'shuru kiya',
    start: 'shuru karna', continued: 'jaari rakha', finished: 'khatam kiya',
    finish: 'khatam karna', began: 'shuru hua', begin: 'shuru hona', ended: 'khatam hua',
    end: 'khatam hona', is: 'hai', are: 'hain', was: 'tha', were: 'the',
    has: 'hai', have: 'hai', had: 'tha', will: 'ega', can: 'sakta hai',
    should: 'chahiye', must: 'zaroor', want: 'chahta hai', wanted: 'chahta tha',
    need: 'zaroorat hai', needed: 'zaroorat thi', like: 'pasand hai', liked: 'pasand tha',
};

function _hinglishWord(word) {
    const lower = word.toLowerCase();
    return HINGLISH_WORDS[lower] !== undefined ? HINGLISH_WORDS[lower] : word;
}

// Sorted longest-phrase-first so multi-word matches win over any word inside them.
const _SORTED_PHRASES = [...HINGLISH_FIXED_PHRASES].sort((a, b) => b[0].length - a[0].length);

function _capitalizeSentences(text) {
    return text.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

function _collapseSpaces(text) {
    return text
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([.,!?])/g, '$1')
        .replace(/^[ \t]+/gm, '')
        .replace(/[ \t]+$/gm, '');
}

function convertToHinglish(text) {
    if (!text) return text;

    let result = text;

    for (const [phrase, replacement] of _SORTED_PHRASES) {
        const re = new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        result = result.replace(re, replacement);
    }

    for (const [re, fn] of HINGLISH_TEMPLATES) {
        result = result.replace(re, fn);
    }

    result = result.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, word => {
        const lower = word.toLowerCase();
        if (!(lower in HINGLISH_WORDS)) return word;
        const swapped = HINGLISH_WORDS[lower];
        return swapped; // may be '' (e.g. "the") — collapsed below
    });

    result = _collapseSpaces(result);
    result = _capitalizeSentences(result);
    return result;
}

// For the title: keeps the original English title and appends its Hinglish
// version after an en dash, e.g. "The Honest Boy – Imaandaar Ladka".
function convertTitleToHinglish(title) {
    return convertToHinglish(title);
}
