// Formaterar ett tal som svenska kronor, t.ex. 12 345,50 kr
const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });

// Dagens datum på svenska, t.ex. "onsdag 25 november 2026"
const today = new Date().toLocaleDateString('sv-SE', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

document.getElementById('today').textContent = today;
document.getElementById('example').textContent = sek.format(12345.5);
