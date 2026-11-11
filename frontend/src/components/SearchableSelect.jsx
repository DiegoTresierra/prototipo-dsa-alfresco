import { useId, useState } from 'react'

/* eslint-disable react/prop-types */
export function SearchableSelect({ label, options, value, onChange, placeholder, required = false }) {
  const listId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [query, setQuery] = useState('')
  const selectedOption = options.find((option) => option.id === value)
  const inputValue = isEditing ? query : selectedOption?.label || ''
  const normalizedQuery = query.trim().toLocaleLowerCase('es')
  const filteredOptions = options.filter((option) => option.label.toLocaleLowerCase('es').includes(normalizedQuery))
  const enabledOptions = filteredOptions.filter((option) => !option.disabled)

  const chooseOption = (option) => {
    if (option.disabled) return
    onChange(option.id)
    setQuery(option.label)
    setIsEditing(false)
    setIsOpen(false)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      setIsEditing(false)
      setQuery('')
    }
    if (event.key === 'ArrowDown') setIsOpen(true)
    if (event.key === 'Enter' && isOpen && enabledOptions.length > 0) {
      event.preventDefault()
      chooseOption(enabledOptions[0])
    }
  }

  return (
    <div className="form-field searchable-select">
      <label className="form-field__label" htmlFor={`${listId}-input`}>{label}{required && <> <b aria-hidden="true">*</b></>}</label>
      <input
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={isOpen}
        aria-label={label}
        aria-required={required}
        autoComplete="off"
        id={`${listId}-input`}
        onBlur={() => { setIsOpen(false); setIsEditing(false); setQuery('') }}
        onChange={(event) => { setQuery(event.target.value); setIsEditing(true); setIsOpen(true); onChange('') }}
        onFocus={() => { setQuery(''); setIsEditing(true); setIsOpen(true) }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role="combobox"
        type="search"
        value={inputValue}
      />
      {isOpen && <div className="searchable-select__options" id={listId} role="listbox">
        {filteredOptions.length === 0 ? <p className="searchable-select__empty">No se encontraron dependencias.</p> : filteredOptions.map((option) => (
          <button
            aria-disabled={option.disabled || undefined}
            aria-selected={option.id === value}
            className={`searchable-select__option ${option.disabled ? 'searchable-select__option--disabled' : ''}`}
            disabled={option.disabled}
            key={option.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => chooseOption(option)}
            role="option"
            type="button"
          >
            <span>{option.label}</span>
            {option.disabled && <small>No disponible para este piloto</small>}
          </button>
        ))}
      </div>}
    </div>
  )
}
