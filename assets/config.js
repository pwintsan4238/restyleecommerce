// Store settings. Edit these values; no rebuild needed.
window.RESTYLE_CONFIG = {
  // Paste the Google Apps Script web app URL here (see apps-script/SETUP.md).
  // While empty, checkout runs in test mode: orders are NOT sent anywhere.
  ORDER_ENDPOINT: 'https://script.google.com/macros/s/AKfycbzFXee0G9Hq5m6smKIbIfRVL6GgVu5hnAF6It6Y0CQnodTPuCN38pcnECDnQ69ZrwI/exec',

  CURRENCY: 'Ks',
  DELIVERY_FEE: 0,

  PAYMENT: {
    title: 'Direct bank transfer',
    kbzNumber: '09892064150',
    kbzName: 'Aye Nyein Phyu',
    // Shown under the payment option at checkout and on the order confirmation
    instructions: [
      'Kbz pay number : 09892064150 (Aye Nyein Phyu) သို့ မိနစ် 30 အတွင်းငွေလွှဲပြီးမှ order confirm ပါ',
      'သင်၏ နောက်ဆုံးတွင် ပေါ်လာမည့် order code အား note တွင်ထည့်ပေးပါ',
      'Note = Clothing + order code',
    ],
    notePrefix: 'Clothing',
  },

  // Optional extra field on the checkout form
  EXTRA_FIELD_LABEL: 'Facebook / Viber name',
};
