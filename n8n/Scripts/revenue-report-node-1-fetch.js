var SUPABASE_URL = 'https://yptbnsegcfpizwhipeep.supabase.co';
var SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwdGJuc2VnY2ZwaXp3aGlwZWVwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAwNjM1MCwiZXhwIjoyMDgzNTgyMzUwfQ.gP_kbCGf_MZtKm1dx3SxfaSXXVwMwoo5JG47GuVDwWI';

var month = $input.first().json.month;
var monthLabel = $input.first().json.monthLabel;

var data = await this.helpers.httpRequest({
  method: 'POST',
  url: SUPABASE_URL + '/functions/v1/customer-revenue-report',
  headers: {
    'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
    'Content-Type': 'application/json'
  },
  body: {
    companyName: 'Neocurrency',
    month: month
  },
  json: true
});

if (data.error) {
  throw new Error(data.error);
}

return [{
  json: {
    reportTitle: data.reportTitle,
    month: data.month,
    company: data.company,
    totalHours: data.totalHours,
    totalRevenue: data.totalRevenue,
    totalRevenueFormatted: data.totalRevenueFormatted,
    monthLabel: monthLabel
  }
}];
