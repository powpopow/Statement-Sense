/**
 * Categorisation.
 *
 * Rules are plain data so they live in the Google Sheet and can be edited
 * there directly. The defaults below seed a new sheet with Thai merchants.
 */
import type { Category, Rule, Transaction } from './types'

interface Seed {
  patterns: string[]
  category: Category
}

const SEEDS: Seed[] = [
  {
    category: 'Food & Drink',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      'FOOD HALL', 'FOODHALL', 'FOOD COURT', 'FAST FOOD', 'FASTFOOD', 'GRILL',
      'SUSHI', 'RAMEN', 'STEAK', 'NOODLE', 'KITCHEN', 'CAFE',
      'TEA', 'JUICE', 'DESSERT', 'ICE CREAM', 'BBQ', 'BURGER',
      'HOTPOT', 'DIM SUM', 'THAI FOOD', 'YAYOI', 'OISHI', 'SHABUSHI',
      'FUJI', 'S&P', 'AFTER YOU', 'BONCHON', 'PIZZA COMPANY', 'SUKISHI',
      'GENKI', 'TONCHIN', 'BINCHO', 'SALAD FACTORY', 'TRUE COFFEE', 'INTHANIN',
      'PUNTHAI', 'BLACK CANYON', 'TOUS LES JOURS', 'TIM HORTONS', 'CHAGEE', 'CHATRAMUE',
      'AMZ_', 'CHESTER', 'DUNKIN', 'KRISPY', 'MR.DONUT', 'MISTER DONUT',
      'ZEN RESTAURANT',
      'STARBUCKS', 'CAFE AMAZON', 'AMAZON CAFE', 'MCDONALD', 'KFC', 'BURGER KING',
      'PIZZA', 'SWENSEN', 'DAIRY QUEEN', 'AU BON PAIN', 'COFFEE', 'BAKERY',
      'MK RESTAURANT', 'SIZZLER', 'SUKI', 'SHABU', 'RESTAURANT', 'BISTRO', 'EATERY',
      'GRABFOOD', 'LINE MAN', 'LINEMAN', 'FOODPANDA', 'ROBINHOOD', 'SHOPEEFOOD',
      'ร้านอาหาร', 'กาแฟ', 'เครื่องดื่ม', 'ชานม',
    ],
  },
  {
    category: 'Groceries',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      '7-11', '7/11', 'CJ MORE', 'COP EXPRESS', 'ARI MARKET', 'FRESH MARKET',
      'SUPERMARKET', 'HYPERMARKET', 'MINIMART', 'MINI MART',
      '7-ELEVEN', '7 ELEVEN', 'SEVEN ELEVEN', 'CP ALL', 'LOTUS', 'TESCO', 'BIG C',
      'MAKRO', 'TOPS', 'VILLA MARKET', 'GOURMET MARKET', 'FOODLAND', 'MAXVALU',
      'FAMILYMART', 'LAWSON', 'GRABMART', 'เซเว่น', 'โลตัส', 'บิ๊กซี', 'แม็คโคร', 'ตลาด',
    ],
  },
  {
    category: 'Transport',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      'PTT STATION', 'FUEL', 'GASOLINE', 'CARPARK', 'CAR PARK', 'VALET',
      'GRABCAR', 'GRABBIKE', 'GRAB TAXI', 'GRABTAXI', 'GRAB RIDE', 'WWW.GRAB.COM', 'GRAB.COM',
      'BOLT', 'INDRIVE', 'TAXI',
      'BTS', 'MRT', 'ARL', 'AIRPORT RAIL', 'SRT', 'EXPRESSWAY', 'EASY PASS', 'MPASS',
      'PTT', 'BANGCHAK', 'ESSO', 'SHELL', 'CALTEX', 'SUSCO', 'PARKING',
      'รถไฟฟ้า', 'ทางด่วน', 'น้ำมัน', 'ที่จอดรถ', 'แท็กซี่',
    ],
  },
  {
    category: 'Shopping',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      'ISTUDIO', 'STUDIO7', 'COM7', 'JIB COMPUTER', 'IT CITY', 'OFFICEMATE',
      'B2S', 'SE-ED', 'KINOKUNIYA', 'DAISO', 'MINISO', 'DECATHLON',
      'CENTRALWORLD', 'HOMEWORKS', 'GLOBAL HOUSE', 'DO HOME', 'BOOKSTORE',
      'SHOPEE', 'LAZADA', 'JD CENTRAL', 'CENTRAL', 'ROBINSON', 'THE MALL', 'SIAM PARAGON',
      'ICONSIAM', 'EMQUARTIER', 'TERMINAL 21', 'UNIQLO', 'H&M', 'ZARA', 'MUJI',
      'POWER BUY', 'BANANA IT', 'JAYMART', 'IKEA', 'HOMEPRO', 'THAIWATSADU',
      'AMAZON', 'APPLE', 'ช้อปปี้', 'ลาซาด้า', 'เซ็นทรัล',
    ],
  },
  {
    category: 'Bills & Utilities',
    patterns: [
      'AIS', 'ADVANCED INFO', 'TRUE MOVE', 'TRUEMOVE', 'TRUE CORP', 'DTAC', 'NT ',
      'MEA', 'PEA', 'METROPOLITAN ELECTRICITY', 'PROVINCIAL ELECTRICITY',
      'WATERWORKS', 'MWA', 'PWA', 'INTERNET', 'BROADBAND', '3BB',
      'ค่าไฟ', 'ค่าน้ำ', 'ค่าโทรศัพท์', 'ค่าอินเทอร์เน็ต', 'ประกัน', 'INSURANCE',
    ],
  },
  {
    category: 'Entertainment',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      'APPLE.COM/BILL', 'ICLOUD', 'GAMES', 'GAMING', 'GARENA', 'RAZER',
      'LINE STICKER', 'LINE GAMES', 'TWITCH', 'DISNEYPLUS', 'APPLE MUSIC', 'YOUTUBE PREMIUM',
      'CINEMA', 'KARAOKE', 'CONCERT', 'THAITICKETMAJOR', 'TICKETMELON',
      'NETFLIX', 'SPOTIFY', 'YOUTUBE', 'DISNEY', 'HBO', 'VIU', 'WETV', 'IQIYI',
      'MAJOR CINEPLEX', 'SF CINEMA', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX',
      'GOOGLE PLAY', 'APP STORE', 'ITUNES', 'โรงหนัง',
    ],
  },
  {
    category: 'Health',
    patterns: [
      // Added with real-statement coverage work: wording first, then chains.
      'DENTIST', 'OPTICAL', 'WELLNESS', 'MASSAGE', 'PHYSIO', 'กายภาพ',
      'HOSPITAL', 'CLINIC', 'BOOTS', 'WATSONS', 'PHARMACY', 'EVE AND BOY', 'DENTAL',
      'BUMRUNGRAD', 'BANGKOK HOSPITAL', 'SAMITIVEJ', 'FITNESS', 'GYM', 'VIRGIN ACTIVE',
      'โรงพยาบาล', 'คลินิก', 'ร้านขายยา', 'ฟิตเนส',
    ],
  },
  {
    category: 'Travel',
    patterns: [
      'THAI AIRWAYS', 'BANGKOK AIRWAYS', 'AIRASIA', 'NOK AIR', 'LION AIR', 'VIETJET',
      'AGODA', 'BOOKING.COM', 'AIRBNB', 'TRAVELOKA', 'EXPEDIA', 'KLOOK', 'HOTEL',
      'RESORT', 'AIRPORT', 'โรงแรม', 'สายการบิน', 'ตั๋วเครื่องบิน',
    ],
  },
  {
    category: 'Gifts & Donations',
    patterns: [
      'FOUNDATIO', 'DONATION', 'CHARITY', 'E-DONATION', 'TEMPLE', 'FLORIST', 'FLOWER',
      'บริจาค', 'มูลนิธิ',
    ],
  },
  {
    category: 'Cash & Transfers',
    patterns: [
      'ATM', 'CASH WITHDRAWAL', 'CDM', 'TRANSFER', 'PROMPTPAY', 'QR PAYMENT',
      'INTERBANK', 'BILL PAYMENT', 'TRUEMONEY', 'RABBIT LINE PAY',
      'ถอนเงิน', 'โอนเงิน', 'พร้อมเพย์', 'เงินโอน',
      // Paying off a credit card moves your own money; it is not income, and
      // counting it as such makes "money in" dwarf real earnings.
      'PAYMENT THANK YOU', 'PAYMENT - THANK YOU', 'PAYMENT RECEIVED',
      'THANK YOU - UOBT', 'AUTO PAYMENT', 'ชำระเงินเข้าบัตร', 'รับชำระค่าบัตร',
    ],
  },
  {
    category: 'Fees & Interest',
    patterns: [
      'FEE', 'SERVICE CHARGE', 'INTEREST', 'ANNUAL FEE', 'LATE PAYMENT', 'FX FEE',
      'FOREIGN TRANSACTION', 'OVERLIMIT', 'STAMP DUTY', 'VAT',
      'ค่าธรรมเนียม', 'ดอกเบี้ย', 'ค่าปรับ', 'ภาษี',
    ],
  },
  {
    category: 'Income',
    patterns: [
      'SALARY', 'PAYROLL', 'DIVIDEND', 'REFUND', 'CASHBACK', 'INTEREST RECEIVED',
      'เงินเดือน', 'เงินปันผล', 'คืนเงิน', 'ดอกเบี้ยรับ',
    ],
  },
]

/**
 * Base priority per category.
 *
 * Specific intent has to outrank generic banking verbs, or a line like
 * "SALARY TRANSFER COMPANY LTD" is claimed by "TRANSFER" and an "AIS MOBILE
 * BILL PAYMENT" by "BILL PAYMENT". Named merchants sit above those verbs;
 * Cash & Transfers and Fees are the fallbacks of last resort.
 */
const CATEGORY_BASE: Record<Category, number> = {
  Income: 300,
  'Bills & Utilities': 200,
  Health: 200,
  Travel: 200,
  Entertainment: 200,
  'Food & Drink': 200,
  Groceries: 200,
  Transport: 200,
  Shopping: 180,
  'Fees & Interest': 120,
  'Rewards & Cashback': 150,
  'Gifts & Donations': 200,
  'Cash & Transfers': 100,
  Uncategorized: 0,
}

export function defaultRules(): Rule[] {
  const rules: Rule[] = []
  SEEDS.forEach((seed, seedIndex) => {
    seed.patterns.forEach((pattern, i) => {
      rules.push({
        id: `seed-${seedIndex}-${i}`,
        pattern,
        matchType: 'contains',
        // Within a category, a longer pattern is the more specific one.
        priority: CATEGORY_BASE[seed.category] + pattern.length,
        category: seed.category,
        enabled: true,
      })
    })
  })
  return rules
}

/**
 * Short acronyms must not match inside a longer word.
 *
 * Plain substring matching makes "NT" (National Telecom) hit PAYME*NT T*HANK
 * YOU, "MEA" hit MEAL and "AIS" hit TH*AIS*. The boundary is letters rather
 * than `\b`, because merchant strings separate tokens with punctuation that
 * `\b` treats as part of the word — LINEPAY*LP_BTS must still match "BTS".
 */
const ACRONYM_RE = /^[A-Za-z]{2,4}$/

export function ruleMatches(rule: Rule, description: string): boolean {
  if (!rule.enabled || !rule.pattern) return false
  if (rule.matchType === 'regex') {
    try {
      return new RegExp(rule.pattern, 'i').test(description)
    } catch {
      return false
    }
  }

  const pattern = rule.pattern.trim()
  if (ACRONYM_RE.test(pattern)) {
    return new RegExp(`(?<![A-Za-z])${pattern}(?![A-Za-z])`, 'i').test(description)
  }
  return description.toUpperCase().includes(pattern.toUpperCase())
}

/**
 * What a row is, for a credit card.
 *
 * A debit is spending. A credit is one of three different things, and none of
 * them is income: a payment of the card's own bill (money moving between your
 * accounts), a refund or points offset that reverses an earlier charge, or a
 * reward such as cashback. Counting them all as "money in" made a card payment
 * of tens of thousands look like earnings.
 */
export type TransactionKind = 'spend' | 'refund' | 'cashback' | 'payment'

const PAYMENT_RE = /^\s*PAYMENT\b|THANK YOU|AUTO\s*PAYMENT|รับชำระ|ชำระเงินเข้าบัตร|ชำระค่าบัตร/i
const CASHBACK_RE = /CASH\s*BACK|REWARD|REBATE|BONUS|เงินคืน|\bCB-\d+/i

export function kindOf(t: { description: string; amount: number }): TransactionKind {
  if (t.amount > 0) return 'spend'
  if (PAYMENT_RE.test(t.description)) return 'payment'
  if (CASHBACK_RE.test(t.description)) return 'cashback'
  return 'refund'
}

/** Cards only: file a credit by what it is, not as income. `hits` is already in priority order. */
function categorizeCardCredit(description: string, hits: Rule[]): Category {
  const kind = kindOf({ description, amount: -1 })
  if (kind === 'payment') return 'Cash & Transfers'
  if (kind === 'cashback') return 'Rewards & Cashback'
  // A refund reverses a charge at the same merchant, so it belongs to that
  // merchant's category and nets against it.
  return hits.find((r) => r.category !== 'Income' && r.category !== 'Cash & Transfers')?.category ?? 'Uncategorized'
}

/** Pick the highest-priority matching rule; ties go to the longer pattern. */
export function categorizeOne(
  description: string,
  amount: number,
  rules: Rule[],
  options: { card?: boolean } = {},
): Category {
  const hits = rules
    .filter((r) => ruleMatches(r, description))
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length)

  if (options.card && amount < 0) return categorizeCardCredit(description, hits)

  if (hits.length) {
    const category = hits[0].category
    // Money coming in that a merchant rule claimed is almost always a refund
    // or a payment, not spending at that merchant.
    if (amount < 0 && category !== 'Income' && category !== 'Cash & Transfers') {
      return 'Income'
    }
    return category
  }
  return amount < 0 ? 'Income' : 'Uncategorized'
}

/** The statement parser labels a row's source with the bank and the kind, e.g. "UOB Thailand — credit card". */
const isCardRow = (t: Transaction) => /credit card/i.test(t.source)

/** Apply rules across a set, leaving hand-picked categories untouched. */
export function applyRules(transactions: Transaction[], rules: Rule[]): Transaction[] {
  return transactions.map((t) =>
    t.categoryLocked
      ? t
      : { ...t, category: categorizeOne(t.description, t.amount, rules, { card: isCardRow(t) }) },
  )
}
