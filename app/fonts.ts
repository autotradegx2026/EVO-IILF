import { Instrument_Serif, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google'

// Public pages (home and sign-in) share these faces; the dashboard keeps its own type.
export const display = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-display' })
export const body = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-body' })
export const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })
export const publicFonts = `${display.variable} ${body.variable} ${mono.variable}`
