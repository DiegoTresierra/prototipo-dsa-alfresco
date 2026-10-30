/* eslint-disable react/prop-types */
import { Icon } from './Icon'

export function PanelPage({ title, description }) {
  return <section aria-labelledby="panel-title" className="panel-page"><p className="breadcrumb">Panel de trabajo</p><h1 id="panel-title">{title}</h1><p className="panel-page__intro">{description}</p><div className="panel-card"><div className="panel-card__mark"><Icon name="file" size={24} /></div><div className="panel-card__text"><h2>Espacio preparado para esta sección</h2><p>Las funcionalidades documentales se incorporarán en una siguiente etapa.</p></div></div></section>
}
