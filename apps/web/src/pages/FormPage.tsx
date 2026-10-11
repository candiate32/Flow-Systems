import { useEffect } from 'react'
import { useParams } from 'react-router'
import { FormRenderer } from '../forms/components/FormRenderer'
import { getFormConfig, HOME_FORM_SLUG } from '../forms/configs'
import NotFound from './NotFound'

/** `/` (the demo studio) and `/f/:slug` (any registered studio form). */
export default function FormPage() {
  const { slug = HOME_FORM_SLUG } = useParams()
  const config = getFormConfig(slug)

  useEffect(() => {
    if (config) document.title = `${config.studio.name}, ${config.studio.area}`
  }, [config])

  if (!config) return <NotFound />
  return <FormRenderer key={config.slug} config={config} fullPage />
}
