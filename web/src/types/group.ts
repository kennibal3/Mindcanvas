// MindCanvas P1 分组类型

export interface Group {
  id: string
  room_id: string
  name: string
  color: string
  members: string[]      // student guest_uuid 数组
  leader_uuid: string    // 空字符串 = 无组长
  sort_order: number
  zone_element_id?: string
  created_at: string
  updated_at: string
}

export interface AutoGroupRequest {
  mode: 'by_groups' | 'by_count'
  n: number
}

export interface AutoGroupResponse {
  message: string
  groups: Pick<Group, 'id' | 'name' | 'color' | 'members' | 'sort_order'>[]
}
