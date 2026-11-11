import { ColaboradorPage } from './ColaboradorPage'
import { DirectorWorkspacePage } from './DirectorWorkspacePage'
import { EspecialistaPage } from './EspecialistaPage'
import { JefeUnidadPage } from './JefeUnidadPage'
import { TecnicoPage } from './TecnicoPage'

export const rolePages = {
  'director-dti': DirectorWorkspacePage,
  'director-dsa': DirectorWorkspacePage,
  director: DirectorWorkspacePage,
  'jefe-unidad-dti': JefeUnidadPage,
  'jefe-unidad-dsa': JefeUnidadPage,
  'especialista-dti': EspecialistaPage,
  'especialista-dsa': EspecialistaPage,
  jefe_unidad: JefeUnidadPage,
  especialista: EspecialistaPage,
  colaborador: ColaboradorPage,
  tecnico: TecnicoPage,
}
