import { z } from 'zod'

export const latitudeSchema = z.number().min(-90).max(90)

export const longitudeSchema = z.number().min(-180).max(180)

export const coordenadasOptionalSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
  })
  .refine(
    (data) => {
      const hasLat = data.latitude !== undefined && data.latitude !== null
      const hasLng = data.longitude !== undefined && data.longitude !== null
      return hasLat === hasLng // ambas presentes ou ambas ausentes
    },
    { message: 'Latitude e longitude devem ser fornecidas em conjunto' }
  )
