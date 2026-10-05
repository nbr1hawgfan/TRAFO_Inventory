/* The only file that changes per customer.
   To make an app for another customer: copy this repo, change these values,
   and add the customer row in Supabase (see README). */
window.APP_CONFIG = {
  customer: "TRAFO",                       // WMS customer code (must exist in cust_app_customers)
  title: "Trane Technologies Inventory",   // header + browser tab
  shortTitle: "Trane Inventory",           // home-screen icon label
  fileBase: "Trane",                       // Excel file names start with this
  api: "https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/customer-inventory"
};
