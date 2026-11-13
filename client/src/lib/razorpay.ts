// Load the Razorpay Checkout script once, on demand.
let loader: Promise<boolean> | null = null;

export function loadRazorpay(): Promise<boolean> {
  if (loader) return loader;
  loader = new Promise((resolve) => {
    if ((window as any).Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { loader = null; resolve(false); };
    document.body.appendChild(s);
  });
  return loader;
}
