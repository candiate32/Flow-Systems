import { useEffect } from 'react'
import { useParams } from 'react-router'
import { FormRenderer } from '../forms/components/FormRenderer'
import { getFormConfig } from '../forms/configs'
import NotFound from './NotFound'

/** `/f/:slug`: one registered studio form on a page of its own, as a client's link would show it. */
export default function FormPage() {
  const { slug = '' } = useParams()
  const config = getFormConfig(slug)

  useEffect(() => {
    if (config) document.title = `${config.studio.name}, ${config.studio.area}`
  }, [config])

  if (!config) return <NotFound />
  return (
    <div className="flex min-h-dvh flex-col">
      <FormRenderer key={config.slug} config={config} fullPage />
    </div>
  )
}
