import { ColaboradorPage } from './ColaboradorPage'
import { DirectorWorkspacePage } from './DirectorWorkspacePage'
import { EspecialistaPage } from './EspecialistaPage'
import { JefeUnidadPage } from './JefeUnidadPage'
import { TecnicoPage } from './TecnicoPage'

export const rolePages = {
  'director-dti': DirectorWorkspacePage,
  'director-dsa': DirectorWorkspacePage,
  director: DirectorWorkspacePage,
  jefe_unidad: JefeUnidadPage,
  especialista: EspecialistaPage,
  colaborador: ColaboradorPage,
  tecnico: TecnicoPage,
}
