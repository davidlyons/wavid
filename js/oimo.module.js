export const OIMO =
  window.OIMO ??
  (await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/oimo@1.0.9/build/oimo.min.js'

    script.onload = () => resolve(window.OIMO)
    script.onerror = reject

    document.head.appendChild(script)
  }))
