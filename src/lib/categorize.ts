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
      '7-ELEVEN', '7 ELEVEN', 'SEVEN ELEVEN', 'CP ALL', 'LOTUS', 'TESCO', 'BIG C',
      'MAKRO', 'TOPS', 'VILLA MARKET', 'GOURMET MARKET', 'FOODLAND', 'MAXVALU',
      'FAMILYMART', 'LAWSON', 'GRABMART', 'เซเว่น', 'โลตัส', 'บิ๊กซี', 'แม็คโคร', 'ตลาด',
    ],
  },
  {
    category: 'Transport',
    patterns: [
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
      'NETFLIX', 'SPOTIFY', 'YOUTUBE', 'DISNEY', 'HBO', 'VIU', 'WETV', 'IQIYI',
      'MAJOR CINEPLEX', 'SF CINEMA', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX',
      'GOOGLE PLAY', 'APP STORE', 'ITUNES', 'โรงหนัง',
    ],
  },
  {
    category: 'Health',
    patterns: [
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

function matches(rule: Rule, description: string): boolean {
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

/** Pick the highest-priority matching rule; ties go to the longer pattern. */
export function categorizeOne(description: string, amount: number, rules: Rule[]): Category {
  const hits = rules
    .filter((r) => matches(r, description))
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length)

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

/** Apply rules across a set, leaving hand-picked categories untouched. */
export function applyRules(transactions: Transaction[], rules: Rule[]): Transaction[] {
  return transactions.map((t) =>
    t.categoryLocked ? t : { ...t, category: categorizeOne(t.description, t.amount, rules) },
  )
}
