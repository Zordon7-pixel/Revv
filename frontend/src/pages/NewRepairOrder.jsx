import { useNavigate } from 'react-router-dom'
import AddROModal from '../components/AddROModal'

export default function NewRepairOrder() {
  const navigate = useNavigate()

  return (
    <div className="space-y-4">
      <AddROModal
        presentation="page"
        onClose={() => navigate('/ros')}
        onSaved={(ro) => {
          if (ro?.id) navigate(`/ros/${ro.id}`)
          else navigate('/ros')
        }}
      />
    </div>
  )
}
