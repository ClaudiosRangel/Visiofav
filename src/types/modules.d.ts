declare module 'pdfkit' {
  class PDFDocument {
    constructor(options?: any)
    pipe(destination: any): any
    fontSize(size: number): this
    font(name: string): this
    text(text: string, x?: number, y?: number, options?: any): this
    moveDown(lines?: number): this
    rect(x: number, y: number, width: number, height: number): this
    stroke(): this
    fill(color: string): this
    fillColor(color: string): this
    strokeColor(color: string): this
    lineWidth(width: number): this
    moveTo(x: number, y: number): this
    lineTo(x: number, y: number): this
    image(src: string | Buffer, x?: number, y?: number, options?: any): this
    addPage(options?: any): this
    end(): void
    on(event: string, listener: (...args: any[]) => void): this
    x: number
    y: number
    page: { width: number; height: number }
  }
  export default PDFDocument
}

declare module 'bwip-js' {
  interface ToBufferOptions {
    bcid: string
    text: string
    scale?: number
    height?: number
    width?: number
    includetext?: boolean
    textxalign?: string
    [key: string]: any
  }
  function toBuffer(options: ToBufferOptions): Promise<Buffer>
  export default { toBuffer }
  export { toBuffer }
}
