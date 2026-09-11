export const volunteerUrl = (eventId: string, token: string) =>
  `${location.origin}/count/${eventId}/${token}`

export const dashboardUrl = (eventId: string) => `${location.origin}/dash/${eventId}`

export const adminUrl = (eventId: string) => `${location.origin}/admin/${eventId}`

export const printUrl = (eventId: string) => `${location.origin}/print/${eventId}`
